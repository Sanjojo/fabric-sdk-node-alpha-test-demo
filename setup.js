/**
 * Created by shanzhihua on 3/28/2017.
 */
var fs = require('fs');
var path = require('path');
var async = require('async');
var utils = require('./fabric-client/lib/utils.js');
var BcSDKApi = require('./utils/BC_sdk_api');

var logger = utils.getLogger('setup.js');

var bc = new BcSDKApi();

function getBcSDKApi(){
    return bc;
}

function initPROD(callback) {
    logger.info('initPROD  ---start---');
    process.env['GOPATH'] = 'fixtures';

    async.series (
        {
            // 'loginUser':function(callback){
            //     bc.logonUser(user,  function(error, res) {
            //         if (error) {
            //             logger.error('注册用户%s失败。错误信息:%j', user.enrollmentID, error);
            //             logger.error('程序退出');
            //             process.exit(1);
            //         }
            //         else {
            //             logger.info('用户成功登录%s', user.enrollmentID);
            //
            //             member = res;
            //             setMember(res);
            //             callback(null, member);
            //         }
            //     });
            // },
            'createChannel':function(callback){
                bc.create_Channel(function(error, res) {
                    if (error) {
                        logger.error('create_Channel失败。');
                        logger.error('程序退出');
                        process.exit(1);
                    }
                    else {
                        logger.info('create_Channel成功。');
                        callback(null, null);
                    }
                });
            },
            'joinChannelorg1':function(callback){
                bc.join_Channel('org1', function(error, res) {
                    if (error) {
                        logger.error('join_Channel失败。');
                        logger.error('程序退出');
                        process.exit(1);
                    }
                    else {
                        logger.info('join_Channel成功。');
                        callback(null, null);
                    }
                });
            },
            // 'joinChannelorg2':function(callback){
            //     bc.join_Channel('org2', function(error, res) {
            //         if (error) {
            //             logger.error('join_Channel失败。');
            //             logger.error('程序退出');
            //             process.exit(1);
            //         }
            //         else {
            //             logger.info('join_Channel成功。');
            //             callback(null, member);
            //         }
            //     });
            // },
            'installChainCodeOrg1':function(callback){
                bc.install_Chaincode('org1', function(error, res) {
                    if (error) {
                        logger.error('install_Proposal失败。');
                        logger.error('程序退出');
                        process.exit(1);
                    }
                    else {
                        logger.info('install_Proposal成功。');
                        callback(null, null);
                    }
                });
            },
            // 'installChainCodeOrg2':function(callback){
            //     bc.install_Chaincode('org2', function(error, res) {
            //         if (error) {
            //             logger.error('install_Proposal失败。');
            //             logger.error('程序退出');
            //             process.exit(1);
            //         }
            //         else {
            //             logger.info('install_Proposal成功。');
            //             callback(null, member);
            //         }
            //     });
            // },
            'instantiateChainCode':function(callback){
                bc.instantiate_Chaincode('org1', function(error, res){
                    if(error){
                        logger.error('instantiate_Proposal失败。');
                        logger.error('程序退出');
                        process.exit(1);
                    }
                    else{
                        logger.info('instantiate_Proposal成功。');
                        callback(null, null);
                    }
                });
            },
            'query':function(callback){
                bc.query_by_chaincode('org1', function(error, res){
                    if(error){
                        logger.error('query_by_chaincode失败。');
                        logger.error('程序退出');
                        callback(null, null);
                    }
                    else{
                        logger.info('query b value : ' + res);
                        callback(null, res);
                    }
                });
            }

    },function(error,result){
        if(error){
            process.exit(1);
        }
        else{
            logger.info('logon -> query 正常完了 : ' + result);
        }

    });


}

module.exports.getBcSDKApi = getBcSDKApi;
module.exports.initPROD = initPROD;