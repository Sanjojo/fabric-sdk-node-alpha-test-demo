/**
 * Created by shanzhihua on 3/28/2017.
 */
var path = require('path');
var fs = require('fs-extra');
var os = require('os');

var jsrsa = require('jsrsasign');
var KEYUTIL = jsrsa.KEYUTIL;

var hfc = require('fabric-client');
var utils = require('../fabric-client/lib/utils.js');
var copService = require('fabric-ca-client/lib/FabricCAClientImpl.js');
var User = require('fabric-client/lib/User.js');
var CryptoSuite = require('fabric-client/lib/impl/CryptoSuite_ECDSA_AES.js');
var KeyStore = require('fabric-client/lib/impl/CryptoKeyStore.js');
var ecdsaKey = require('fabric-client/lib/impl/ecdsa/key.js');

var logger = utils.getLogger('utils/util.js');

module.exports.CHAINCODE_PATH = 'github.com/example_cc';
// module.exports.CHAINCODE_MARBLES_PATH = 'github.com/marbles_cc';
module.exports.END2END = {
    channel: 'mychannel',
    chaincodeId: 'end2end',
    chaincodeVersion: 'v0'
};

// directory for file based KeyValueStore
module.exports.KVS = '/tmp/hfc-test-kvs';
module.exports.storePathForOrg = function(org) {
    return module.exports.KVS + '_' + org;
};

// temporarily set $GOPATH to the test fixture folder
module.exports.setupChaincodeDeploy = function() {
    process.env.GOPATH = 'chaincode';
};

// specifically set the values to defaults because they may have been overridden when
// running in the overall test bucket ('gulp test')
module.exports.resetDefaults = function() {
    global.hfc.config = undefined;
    require('nconf').reset();
};

module.exports.cleanupDir = function(keyValStorePath) {
    var absPath = path.join(process.cwd(), keyValStorePath);
    var exists = module.exports.existsSync(absPath);
    if (exists) {
        fs.removeSync(absPath);
    }
};

module.exports.getUniqueVersion = function(prefix) {
    if (!prefix) prefix = 'v';
    return prefix + Date.now();
};

// utility function to check if directory or file exists
// uses entire / absolute path from root
module.exports.existsSync = function(absolutePath /*string*/) {
    try  {
        var stat = fs.statSync(absolutePath);
        if (stat.isDirectory() || stat.isFile()) {
            return true;
        } else {
            return false;
        }
    }
    catch (e) {
        return false;
    }
};

module.exports.readFile = readFile;

hfc.addConfigFile('./config.json');
var ORGS = hfc.getConfigSetting('test-network');

var	tlsOptions = {
    trustedRoots: [],
    verify: false
};

function getSubmitter(username, password, client, loadFromConfig, userOrg) {
    var caUrl = ORGS[userOrg].ca;

    return client.getUserContext(username)
            .then(function(user){
            return new Promise(function(resolve, reject){
                if (user && user.isEnrolled()) {
                    logger.info('Successfully loaded member from persistence');
                    return resolve(user);
                }

                if (!loadFromConfig) {
                    // need to enroll it with CA server
                    var cop = new copService(caUrl, tlsOptions, {keysize: 256, hash: 'SHA2'});

                    var member;
                    return cop.enroll({
                            enrollmentID: username,
                            enrollmentSecret: password
                    }).then(function(enrollment){
                        logger.info('Successfully enrolled user \'' + username + '\'');
                        member = new User(username, client);
                        return member.setEnrollment(enrollment.key, enrollment.certificate, ORGS[userOrg].mspid);
                    }).then(function(){
                        return client.setUserContext(member);
                    }).then(function(){
                        return resolve(member);
                    }).catch(function(err){
                        logger.error('Failed to enroll and persist user. Error: ' + err.stack ? err.stack : err);
                    });
                } else {
                    // need to load private key and pre-enrolled certificate from files based on the MSP
                    // config directory structure:
                    // <config>
                    //    \_ keystore
                    //       \_ admin.pem  <<== this is the private key saved in PEM file
                    //    \_ signcerts
                    //       \_ admin.pem  <<== this is the signed certificate saved in PEM file

                    // first load the private key and save in the BCCSP's key store
                    var privKeyPEM = path.join(__dirname,'../fixtures/msp/local/keystore/admin.pem');
                    var pemData, member;
                    return readFile(privKeyPEM)
                            .then(function(data){
                            pemData = data;
                    // default crypto suite uses $HOME/.hfc-key-store as key store
                    var kspath = CryptoSuite.getDefaultKeyStorePath();
                    var testKey;
                    return new KeyStore({
                        path: kspath
                    });
                }).then(function(store){
                    var rawKey = KEYUTIL.getKey(pemData.toString());
                    testKey = new ecdsaKey(rawKey);
                    return store.putKey(testKey);
                }).then(function(value){
                    // next save the certificate in a serialized user enrollment in the state store
                    var certPEM = path.join(__dirname,'../fixtures/msp/local/signcerts/admin.pem');
                    return readFile(certPEM);
                }).then(function(data){
                    member = new User(username, client);
                    return member.setEnrollment(testKey, data.toString(), ORGS[userOrg].mspid);
                }).then(function(){
                    return client.setUserContext(member);
                }).then(function(user){
                    return resolve(user);
                }).catch(function(err){
                    reject(new Error('Failed to load key or certificate and save to local stores. ' + err));
                });
            }
        });
    });
}

function readFile(path) {
    return new Promise(function(resolve, reject){
        fs.readFile(path, function(err, data){
            if (!!err)
                reject(new Error('Failed to read file ' + path + ' due to error: ' + err));
            else
                resolve(data);
        });
    });
}

module.exports.getSubmitter = function(client, loadFromConfig, org) {
    if (arguments.length < 1) throw new Error('"client" is required parameters');

    var fromConfig, userOrg;
    if (typeof loadFromConfig === 'boolean') {
        fromConfig = loadFromConfig;
    } else {
        fromConfig = false;
    }

    if (typeof loadFromConfig === 'string') {
        userOrg = loadFromConfig;
    } else {
        if (typeof org === 'string') {
            userOrg = org;
        } else {
            userOrg = 'org1';
        }
    }

    return getSubmitter('admin', 'adminpw', client, fromConfig, userOrg);
};