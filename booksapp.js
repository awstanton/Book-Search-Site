'use strict';

(async function() {
    //// IMPORT MODULES ////
    const express = require('express');
    const fs = require('fs');
    const https = require('https');
    const helmet = require('helmet');
    const bunyan = require('bunyan');
    const { MongoClient } = require('mongodb');
    const handlers = require('./booksapp-handlers');
    const session = require('express-session');
    const FileStore = require('session-file-store')(session);
    const { v4: uuidv4, parse: uuidParse, stringify: uuidStringify } = require('uuid');
    var level = require('level');


    //// SET UP LOGGER ////
    var logger = bunyan.createLogger(
        { name: "booksApp",
        streams: [
            {
                stream: process.stdout,
                level: 'trace'
            },
            // {
            //     path: __dirname + '/logs/booksapp.log',
            //     level: 'info'
            // },
            {
                type: 'rotating-file',
                path: __dirname + '/logs/booksapp-rotate.log',
                period: '1d',
                count: 2,
                level: 'info'
            }
        ],
        serializers: {
            req: bunyan.stdSerializers.req,
            res: bunyan.stdSerializers.res,
            err: bunyan.stdSerializers.err
        }
    });


    //// SET UP DATABASE ////
    const dbUri = 'mongodb://127.0.0.1:27017';
    const dbClient = new MongoClient(dbUri, { useUnifiedTopology: true });
    try {
        await dbClient.connect();
        console.log('connected to database on port 27017');
    } catch(e) {
        console.error(e);
        await dbClient.close();
    }


    //// SET UP INVERTED INDEX ////
    // Note: should be fine without callback since according to NPM level documentation, any reads or writes before it is opened are queued internally
    var invertedIndex;
    await new Promise((resolve, reject) => {
        invertedIndex = level("C:/Users/Andrew/Documents/NodeJSApps/HelloWorld/booksdb", {valueEncoding: 'json'}, (err) => {
            if (err) throw err;
            else resolve();
        })
    });

    
    //// SET UP WEB FRAMEWORK ////
    var app = express();
    const port = process.env.PORT || 8000;
    app.set('view engine', 'ejs');
    app.set('views', __dirname + '/views');
    app.use(express.static(__dirname + '/public'));
    app.use(express.urlencoded({ extended: false, type: "application/x-www-form-urlencoded" })); // for parsing application/x-www-form-urlencoded


    //// CONFIGURE CSP ////
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "https: 'unsafe-inline'", "https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js", "https://www.google.com/books/jsapi.js"],
                objectSrc: ["'none'"],
                imgSrc: ["'self'", "https://*"],
                styleSrc: ["'self'", "https: 'unsafe-inline'"],
                upgradeInsecureRequests: [],
            },
        }
    }));

    //// CONFIGURE SESSION ////
var fileStoreOptions = {};

    app.use(session({
        store: new FileStore(fileStoreOptions),
        secret: 'pwdpwdpnwdpnwd',
        cookie: {
            httpOnly: true,
            secure: true,
            sameSite: true
        },
        genid: uuidv4,
        resave: false,
        saveUninitialized: false
    }));

    //// REGISTER HANDLERS ////
    handlers(app, dbClient, logger, invertedIndex);
    

    //// START SERVER ////
    // perhaps use a key and cert here instead so passphrase is not revealed, or pass it as command line argument
    https.createServer({ pfx: fs.readFileSync('storekey.pfx'), passphrase: 'storekey' }, app)
    .listen(port, () => console.log(`booksapp started on port ${port}`));
})();


// const debug = require('debug');
// const logger = require('morgan');
// app.listen(port, () => console.log(`app started on port ${port}`));
// app.use(logger('combined'));
// // var router = express.Router()
// // // simple logger for this router's requests
// // // all requests to this router will first hit this middleware
// // router.use(function (req, res, next) {
// //   console.log('%s %s %s', req.method, req.url, req.path)
// //   next()
// // })
// // app.use('/', router);