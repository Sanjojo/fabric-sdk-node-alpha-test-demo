/**
 * Created by shanzhihua on 3/28/2017.
 */
var hfc = require('fabric-client');
var utils = require('fabric-client/lib/utils.js');
var Peer = require('fabric-client/lib/Peer.js');
var Orderer = require('fabric-client/lib/Orderer.js');
var EventHub = require('fabric-client/lib/EventHub.js');
var User = require('fabric-client/lib/User.js');
var fs = require('fs');
var path = require('path');
var grpc = require('grpc');
var testUtil = require('./util.js');

var logger = utils.getLogger('utils/BC_sdk_api.js');

var the_user = null;
var tx_id = null;
var nonce = null;
var allEventhubs = [];



var bcSdkApi = function() {
    logger.info('bcSDKAPI  ---start---');

    var _bcSdkApi = {};

    hfc.addConfigFile('./config.json');
    var ORGS = hfc.getConfigSetting('test-network');

    //can't require(...)    error: import "../google/protobuf/timestamp.proto"; SyntaxError: Unexpected token import
    var _commonProto = grpc.load('./node_modules/fabric-client/lib/protos/common/common.proto').common;

    var create_Channel = function(callback) {
        logger.info('createChannel-------start---------');

        var client = new hfc();
        var chain = client.newChain(testUtil.END2END.channel);

        var caRootsPath = ORGS.orderer.tls_cacerts;
        let data = fs.readFileSync(path.join(__dirname,caRootsPath));
        let caroots = Buffer.from(data).toString();

        chain.addOrderer(
            new Orderer(
            ORGS.orderer.url,
            {
                'pem': caroots,
                'ssl-target-name-override': ORGS.orderer['server-hostname']
            }
        ));

        // Acting as a client in org1 when creating the channel
        var org = ORGS.org1.name;

        // utils.setConfigSetting('key-value-store', path.join(__dirname,'../fabric-client/lib/impl/FileKeyValueStore.js'));
        return hfc.newDefaultKeyValueStore({
                path: testUtil.storePathForOrg(org)
        }).then(function(store){
            client.setStateStore(store);
            // return testUtil.getSubmitter(client, true, 'org1');
            return testUtil.getSubmitter(client, 'org1');
        })
        .then(function(admin){
            logger.info('Successfully enrolled user \'admin\'');
            the_user = admin;

            // readin the envelope to send to the orderer
            data = fs.readFileSync(path.join(__dirname,'../fixtures/channel/mychannel.tx'));
            var request = {
                envelope : data
            };
            // send to orderer
            return chain.createChannel(request);
        }, function(err){
                logger.error('Failed to enroll user \'admin\'. ' + err);
                callback('Failed to enroll user \'admin\'. ' + err);
        })
        .then(function(response){
            logger.info(' response ::%j',response);

            if (response && response.status === 'SUCCESS') {
                logger.info('Successfully created the channel.');
                return sleep(5000);
            } else {
                logger.error('Failed to create the channel. ');
                callback('Failed to create the channel. ');
            }
        }, function(err){
            logger.error('Failed to initialize the channel: ' + err.stack ? err.stack : err);
            callback('Failed to create the channel. ');
        })
        .then(function(nothing){
            logger.info('Successfully waited to make sure new channel was created.');
            callback(null, null);
        }, function(err){
            logger.error('Failed to sleep due to error: ' + err.stack ? err.stack : err);
            callback('Failed to sleep due to error: ' + err.stack ? err.stack : err);
        });
    };

    var join_Channel = function(org, callback) {
        logger.info('join_Channel-------start---------');

        var client = new hfc();
        var chain = client.newChain(testUtil.END2END.channel);
        var caRootsPath = ORGS.orderer.tls_cacerts;
        let data = fs.readFileSync(path.join(__dirname, caRootsPath));
        let caroots = Buffer.from(data).toString();

        chain.addOrderer(
            new Orderer(
                ORGS.orderer.url,
                {
                    'pem': caroots,
                    'ssl-target-name-override': ORGS.orderer['server-hostname']
                }
            )
        );

        var orgName = ORGS[org].name;

        var targets = [];
        var eventhubs = [];

        //new peer
        for (let key in ORGS[org]) {
            if (ORGS[org].hasOwnProperty(key)) {
                if (key.indexOf('peer') === 0) {
                    data = fs.readFileSync(path.join(__dirname,ORGS[org][key]['tls_cacerts']));
                    targets.push(
                        new Peer(
                            ORGS[org][key].requests,
                            {
                                pem: Buffer.from(data).toString(),
                                'ssl-target-name-override': ORGS[org][key]['server-hostname']
                            }
                        )
                    );

                    let eh = new EventHub();
                    eh.setPeerAddr(
                        ORGS[org][key].events,
                        {
                            pem: Buffer.from(data).toString(),
                            'ssl-target-name-override': ORGS[org][key]['server-hostname']
                        }
                    );
                    eh.connect();
                    eventhubs.push(eh);
                    allEventhubs.push(eh);
                }
            }
        }

        return hfc.newDefaultKeyValueStore({
            path: testUtil.storePathForOrg(orgName)
        }).then(function(store){
            client.setStateStore(store);
            // return testUtil.getSubmitter(client, true, org);
            return testUtil.getSubmitter(client, org);
        })
        .then(function(admin){
            logger.info('Successfully enrolled user \'admin\'');
            the_user = admin;

            nonce = utils.getNonce();
            tx_id = chain.buildTransactionID(nonce, the_user);

            var request = {
                targets : targets,
                txId : 	tx_id,
                nonce : nonce
            };

            var eventPromises = [];
            eventhubs.forEach(function(eh){
                let txPromise = new Promise(function(resolve, reject){
                    let handle = setTimeout(reject, 30000);

                    eh.registerBlockEvent(function(block){
                        clearTimeout(handle);

                        // in real-world situations, a peer may have more than one channels so
                        // we must check that this block came from the channel we asked the peer to join
                        if(block.data.data.length === 1) {
                            // Config block must only contain one transaction
                            var envelope = _commonProto.Envelope.decode(block.data.data[0]);
                            var payload = _commonProto.Payload.decode(envelope.payload);
                            var channel_header = _commonProto.ChannelHeader.decode(payload.header.channel_header);

                            if (channel_header.channel_id === testUtil.END2END.channel) {
                                logger.info('The new channel has been successfully joined on peer '+ eh.ep._endpoint.addr);
                                resolve();
                            }
                        }
                    });
                });

                eventPromises.push(txPromise);
            });
            let sendPromise = chain.joinChannel(request);
            return Promise.all([sendPromise].concat(eventPromises));
            // return Promise.all([sendPromise]);
        }, function(err){
            logger.error('Failed to enroll user \'admin\' due to error: ' + err.stack ? err.stack : err);
            callback('Failed to enroll user \'admin\' due to error: ' + err.stack ? err.stack : err);
        })
        .then(function(results){
            logger.info('Join Channel R E S P O N S E : ', results);

            for(let key in eventhubs) {
                let e = eventhubs[key];
                if (e && e.isconnected()) {
                    logger.info('Disconnecting the event hub');
                    e.disconnect();
                }
            }

            if(results[0] && results[0][0] && results[0][0].response && results[0][0].response.status == 200) {
                logger.info('Successfully joined peers in organization '+ orgName +' to join the channel');
                callback(null,null);
            } else {
                logger.error('Failed to join channel');
                callback('Failed to join channel');
            }
        }, function(err){

            for(let key in eventhubs) {
                let e = eventhubs[key];
                if (e && e.isconnected()) {
                    logger.info('Disconnecting the event hub');
                    e.disconnect();
                }
            }

            logger.error('Failed to join channel due to error: ' + err.stack ? err.stack : err);
            callback('Failed to join channel due to error: ' + err.stack ? err.stack : err);
        });
    };

    var install_Chaincode = function(org, callback) {
        logger.info('install_Chaincode-------start---------');

        var client = new hfc();
        var chain = client.newChain(testUtil.END2END.channel);

        var caRootsPath = ORGS.orderer.tls_cacerts;
        let data = fs.readFileSync(path.join(__dirname, caRootsPath));
        let caroots = Buffer.from(data).toString();

        chain.addOrderer(
            new Orderer(
                ORGS.orderer.url,
                {
                    'pem': caroots,
                    'ssl-target-name-override': ORGS.orderer['server-hostname']
                }
            )
        );

        var orgName = ORGS[org].name;

        var targets = [];
        for (let key in ORGS[org]) {
            if (ORGS[org].hasOwnProperty(key)) {
                if (key.indexOf('peer') === 0) {
                    let data = fs.readFileSync(path.join(__dirname,ORGS[org][key]['tls_cacerts']));
                    let peer = new Peer(
                        ORGS[org][key].requests,
                        {
                            pem: Buffer.from(data).toString(),
                            'ssl-target-name-override': ORGS[org][key]['server-hostname']
                        }
                    );

                    targets.push(peer);
                    chain.addPeer(peer);
                }
            }
        }

        return hfc.newDefaultKeyValueStore({
            path: testUtil.storePathForOrg(orgName)
        }).then(function(store){
            client.setStateStore(store);
            // return testUtil.getSubmitter(client, true, org);
            return testUtil.getSubmitter(client, org);
        }).then(function(admin){
            logger.info('Successfully enrolled user \'admin\'');
            the_user = admin;

            nonce = utils.getNonce();
            tx_id = chain.buildTransactionID(nonce, the_user);

            // send proposal to endorser
            var request = {
                targets: targets,
                chaincodePath: testUtil.CHAINCODE_PATH,
                chaincodeId: testUtil.END2END.chaincodeId,
                chaincodeVersion: testUtil.END2END.chaincodeVersion,
                txId: tx_id,
                nonce: nonce
            };

            return chain.sendInstallProposal(request);
        },function(err){
                logger.error('Failed to enroll user \'admin\'. ' + err);
                callback('Failed to enroll user \'admin\'. ' + err);
        }).then(function(results){
            var proposalResponses = results[0];

            var proposal = results[1];
            var header   = results[2];
            var all_good = true;
            for(var i in proposalResponses) {
                let one_good = false;
                if (proposalResponses && proposalResponses[0].response && proposalResponses[0].response.status === 200) {
                    one_good = true;
                    logger.info('install proposal was good');
                } else {
                    logger.error('install proposal was bad');
                }
                all_good = all_good & one_good;
            }
            if (all_good) {
                logger.info('Successfully sent install Proposal and received ProposalResponse: Status - '+ proposalResponses[0].response.status);
                callback(null,null);
            } else {
                logger.error('Failed to send install Proposal or receive valid response. Response null or status is not 200. exiting...');
                callback('Failed to send install Proposal or receive valid response. Response null or status is not 200. exiting...');
            }
        },function(err){
            logger.info('Failed to send install proposal due to error: ' + err.stack ? err.stack : err);
            callback('Failed to send install proposal due to error: ' + err.stack ? err.stack : err);
        });
    };

    var instantiate_Chaincode = function(org, callback){
        logger.info('instantiate_Chaincode-------start---------');

        var client = new hfc();
        var chain = client.newChain(testUtil.END2END.channel);

        var caRootsPath = ORGS.orderer.tls_cacerts;
        let data = fs.readFileSync(path.join(__dirname,caRootsPath));
        let caroots = Buffer.from(data).toString();

        chain.addOrderer(
            new Orderer(
                ORGS.orderer.url,
                {
                    'pem': caroots,
                    'ssl-target-name-override': ORGS.orderer['server-hostname']
                }
            )
        );

        var orgName = ORGS[org].name;

        var eventhubs = [];

        // set up the chain to use each org's 'peer1' for
        // both requests and events
        let key = org;
        if (key) {
        // for (let key in ORGS) {
            if (ORGS.hasOwnProperty(key) && typeof ORGS[key].peer1 !== 'undefined') {
                let data = fs.readFileSync(path.join(__dirname,ORGS[key].peer1['tls_cacerts']));
                let peer = new Peer(
                    ORGS[key].peer1.requests,
                    {
                        pem: Buffer.from(data).toString(),
                        'ssl-target-name-override': ORGS[key].peer1['server-hostname']
                    }
                );
                chain.addPeer(peer);

                let eh = new EventHub();
                eh.setPeerAddr(
                    ORGS[key].peer1.events,
                    {
                        pem: Buffer.from(data).toString(),
                        'ssl-target-name-override': ORGS[key].peer1['server-hostname']
                    }
                );
                eh.connect();
                eventhubs.push(eh);
                allEventhubs.push(eh);
            }
        }

        return hfc.newDefaultKeyValueStore({
            path: testUtil.storePathForOrg(orgName)
        }).then(function(store){
            client.setStateStore(store);
            // return testUtil.getSubmitter(client, true, org);
            return testUtil.getSubmitter(client, org);
        }).then(function(admin){
            logger.info('Successfully enrolled user \'admin\'');
            the_user = admin;

            // read the config block from the orderer for the chain
            // and initialize the verify MSPs based on the participating
            // organizations
            return chain.initialize();
        }, function(err){
            logger.error('Failed to enroll user \'admin\'. ' + err);
            callback('Failed to enroll user \'admin\'. ' + err);
        }).then(function(success){
            nonce = utils.getNonce();
            tx_id = chain.buildTransactionID(nonce, the_user);
            // send proposal to endorser
            var request = {
                chaincodePath: testUtil.CHAINCODE_PATH,
                chaincodeId: testUtil.END2END.chaincodeId,
                chaincodeVersion: testUtil.END2END.chaincodeVersion,
                fcn: 'init',
                args: ['a', '100', 'b', '200'],
                chainId: testUtil.END2END.channel,
                txId: tx_id,
                nonce: nonce
            };
            return chain.sendInstantiateProposal(request);
        }, function(err){
            logger.error('Failed to initialize the chain');
            throw new Error('Failed to initialize the chain');
        }).then(function(results){
            var proposalResponses = results[0];
            var proposal = results[1];
            var header   = results[2];
            var all_good = true;
            for(var i in proposalResponses) {
                let one_good = false;
                if (proposalResponses && proposalResponses[0].response && proposalResponses[0].response.status === 200) {
                    one_good = true;
                    logger.info('instantiate proposal was good');
                } else {
                    logger.error('instantiate proposal was bad');
                }
                all_good = all_good & one_good;
            }
            if (all_good) {
                logger.info('Successfully sent Proposal and received ProposalResponse: Status - '+proposalResponses[0].response.status+'' +
                    ', message - "'+proposalResponses[0].response.message+'"' +
                    ', metadata - "'+proposalResponses[0].response.payload+'"' +
                    ', endorsement signature: '+proposalResponses[0].endorsement.signature);

                var request = {
                    proposalResponses: proposalResponses,
                    proposal: proposal,
                    header: header
                };

                // // set the transaction listener and set a timeout of 30sec
                // // if the transaction did not get committed within the timeout period,
                // // fail the test
                // var deployId = tx_id.toString();
                //
                // var eventPromisesTx = [];
                // eventhubs.forEach(function(eh){
                //     let txPromise = new Promise(function(resolve, reject){
                //         let handle = setTimeout(reject, 30000);
                //
                //         eh.registerTxEvent(deployId.toString(), function(tx, code){
                //             clearTimeout(handle);
                //             logger.info('The chaincode instantiate transaction has been committed on peer '+ eh.ep._endpoint.addr);
                //             // eh.unregisterTxEvent(deployId);
                //             if (code !== 'VALID') {
                //                 logger.error('The chaincode instantiate transaction was invalid, code = ' + code);
                //                 reject();
                //             } else {
                //                 logger.info('The chaincode instantiate transaction was valid.');
                //                 resolve();
                //             }
                //         });
                //     });
                //     eventPromisesTx.push(txPromise);
                // });

                var sendPromise = chain.sendTransaction(request);
                // return Promise.all([sendPromise].concat(eventPromisesTx))
                return Promise.all([sendPromise])
                    .then(function(results){
                        logger.info('Event promise all complete and testing complete');
                        return results[0]; // the first returned value is from the 'sendPromise' which is from the 'sendTransaction()' call
                    }).catch(function(err){
                        logger.error('Failed to send instantiate transaction and get notifications within the timeout period.');
                        callback('Failed to send instantiate transaction and get notifications within the timeout period.');
                    });
            } else {
                logger.error('Failed to send instantiate Proposal or receive valid response. Response null or status is not 200. exiting...');
                callback('Failed to send instantiate Proposal or receive valid response. Response null or status is not 200. exiting...');
            }
        }, function(err){
            logger.error('Failed to send instantiate proposal due to error: ' + err.stack ? err.stack : err);
            callback('Failed to send instantiate proposal due to error: ' + err.stack ? err.stack : err);
        }).then(function(response){

            for(let key in eventhubs) {
                let e = eventhubs[key];
                if (e && e.isconnected()) {
                    logger.info('Disconnecting the event hub');
                    e.disconnect();
                }
            }

            if (response.status === 'SUCCESS') {
                logger.info('Successfully sent transaction to the orderer.');
                sleep(10000).then(function(nothing) {
                    logger.info('wait 10 s before callback.');
                    callback(null,null);
                });
            } else {
                logger.error('Failed to order the transaction. Error code: ' + response.status);
                callback('Failed to order the transaction. Error code: ' + response.status);
            }
        }, function(err){

            for(let key in eventhubs) {
                let e = eventhubs[key];
                if (e && e.isconnected()) {
                    logger.info('Disconnecting the event hub');
                    e.disconnect();
                }
            }

            logger.error('Failed to send instantiate due to error: ' + err.stack ? err.stack : err);
            callback('Failed to send instantiate due to error: ' + err.stack ? err.stack : err);
        });
    };

    var query_by_chaincode = function(org, callback) {
        logger.info('query_by_chaincode-------start---------');

        var client = new hfc();
        var chain = client.newChain(testUtil.END2END.channel);

        var orgName = ORGS[org].name;

        var targets = [];
        // set up the chain to use each org's 'peer1' for
        // both requests and events
        let key = org;
        if (key) {
        // for (let key in ORGS) {
            if (ORGS.hasOwnProperty(key) && typeof ORGS[key].peer1 !== 'undefined') {
                let data = fs.readFileSync(path.join(__dirname,ORGS[key].peer1['tls_cacerts']));
                let peer = new Peer(
                    ORGS[key].peer1.requests,
                    {
                        pem: Buffer.from(data).toString(),
                        'ssl-target-name-override': ORGS[key].peer1['server-hostname']
                    });
                chain.addPeer(peer);
            }
        }

        return hfc.newDefaultKeyValueStore({
            path: testUtil.storePathForOrg(orgName)
        }).then(function(store){
            client.setStateStore(store);
            // return testUtil.getSubmitter(client, true, org);
            return testUtil.getSubmitter(client, org);
        }).then(function(admin){
            the_user = admin;
            nonce = utils.getNonce();
            tx_id = chain.buildTransactionID(nonce, the_user);

            // send query
            var request = {
                chaincodeId : testUtil.END2END.chaincodeId,
                chaincodeVersion : testUtil.END2END.chaincodeVersion,
                chainId: testUtil.END2END.channel,
                txId: tx_id,
                nonce: nonce,
                fcn: 'invoke',
                args: ['query','b']
            };
            return chain.queryByChaincode(request);
        },function(err){
            logger.info('Failed to get submitter \'admin\'. Error: ' + err.stack ? err.stack : err );
            callback('Failed to get submitter \'admin\'. Error: ' + err.stack ? err.stack : err );
        }).then(function(response_payloads){
            if (response_payloads) {
                for(let i = 0; i < response_payloads.length; i++) {
                    logger.info("query result:" + response_payloads[i].toString('utf8'));
                }
                callback(null,response_payloads[0].toString('utf8'));
            } else {
                logger.error('response_payloads is null');
                callback('response_payloads is null');
            }
        },function(err){
            logger.error('Failed to send query due to error: ' + err.stack ? err.stack : err);
            callback('Failed to send query due to error: ' + err.stack ? err.stack : err);
        }).catch(function(err){
            logger.error('Failed to end to end test with error:' + err.stack ? err.stack : err);
            callback('Failed to end to end test with error:' + err.stack ? err.stack : err);
        });
    };

    function sleep(ms) {
        return new Promise(function(resolve){setTimeout(resolve, ms)});
    }

    _bcSdkApi.create_Channel = create_Channel;
    _bcSdkApi.join_Channel = join_Channel;
    _bcSdkApi.install_Chaincode = install_Chaincode;
    _bcSdkApi.instantiate_Chaincode = instantiate_Chaincode;
    _bcSdkApi.query_by_chaincode = query_by_chaincode;
    return _bcSdkApi;
};

module.exports = bcSdkApi;