var express = require('express');
var router = express.Router();
var bc = require('../setup').getBcSDKApi();
var setup = require('../setup');
var utils = require('fabric-client/lib/utils.js');


var logger = utils.getLogger('index.js');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
});


router.get('/chaincode/query_by_org1', function(req, res, next) {
    logger.info('/chaincode/query_by_org1  ----start----');
    bc.query_by_chaincode('org1',function(err, result){
        if(err){
            logger.error('/chaincode/query_by_org1  ----error----');
        }
        else{
            logger.info('/chaincode/query_by_org1  ----end---- result : ' + result);
        }
    });
    res.render('index', { title: 'Express' });
});

router.get('/chaincode/invoke_by_org1', function(req, res, next) {
    logger.info('/chaincode/invoke_by_org1  ----start----');
    bc.invoke_by_chaincode('org1',function(err, result){
        if(err){
            logger.error('/chaincode/invoke_by_org1  ----error----');
        }
        else{
            logger.info('/chaincode/invoke_by_org1  success ----end---- ');
        }
    });
    res.render('index', { title: 'Express' });
});

module.exports = router;
