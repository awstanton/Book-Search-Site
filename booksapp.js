'use strict';

(async function() {
    //// IMPORT MODULES ////
    const express = require('express');
    const fs = require('fs');
    const http = require('http');
    const https = require('https');
    const helmet = require('helmet');
    const bunyan = require('bunyan');
    const { MongoClient } = require('mongodb');
    const handlers = require('./booksapp-handlers');
    const session = require('express-session');
    const FileStore = require('session-file-store')(session);
    const { v4: uuidv4, parse: uuidParse, stringify: uuidStringify } = require('uuid');
    var level = require('level');
    const cryptoRandomString = require('crypto-random-string');


    //// SET UP LOGGER ////
    var logsDir = __dirname + '/logs';
    var logsFile = 'booksapp-rotate.log';

    if (!fs.existsSync(logsDir))
        fs.mkdirSync(logsDir);

    var logger = bunyan.createLogger(
        { name: "booksApp",
        streams: [
            {
                stream: process.stdout,
                level: 'trace'
            },
            {
                type: 'rotating-file',
                path: logsDir +  '/' + logsFile,
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
    let dbUri;

    if (process.env.NODE_ENV === 'prod') {
        dbUri = "mongodb+srv://booksUser:2IlKgUwYlZEjCwJO@booksappcluster.hu4bg.mongodb.net/booksapp?retryWrites=true&w=majority";
    }
    else {
        dbUri = 'mongodb://127.0.0.1:27017';
    }
    
    const dbClient = new MongoClient(dbUri, { useNewUrlParser: true, useUnifiedTopology: true });
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
        invertedIndex = level(__dirname + "/booksdb", {valueEncoding: 'json'}, (err) => {
            if (err) throw err;
            else resolve();
        })
    });

    
    //// SET UP WEB FRAMEWORK ////
    var app = express();
    const port = process.env.PORT || 3000;
    const httpsPort = 8000;

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

    if (process.env.NODE_ENV === "prod") {
        app.get('*', function(req, res, next) {
            if (req.headers['x-forwarded-proto'] !== 'https') {
                return res.redirect('https://' + req.hostname + ':' + httpsPort + req.url);
            }
            return next();
        });
    }
    else {
        app.get('*', function(req, res, next) {
            if (req.protocol !== "https") {
                console.log(req.get('Host'));
                return res.redirect('https://' + req.hostname + ':' + httpsPort + req.url);
            }
            return next();
        });
    }
    

    //// CONFIGURE SESSION ////
    app.use(session({
        store: new FileStore({}),
        secret: cryptoRandomString({length: 10}),
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
    let options;
    if (process.env.NODE_ENV === 'prod') {
        options = {
            key: fs.readFileSync(__dirname + '/server.key'),
            cert: fs.readFileSync(__dirname + '/server.cert')
        };
    }
    else {
        options = {
            key: fs.readFileSync(__dirname + '/server-dev.key'),
            cert: fs.readFileSync(__dirname + '/server-dev.cert')
        };
    }
    http.createServer(app).listen(port, () => { console.log(`booksapp started on port ${port}`) });
    https.createServer(options, app)
    //https.createServer({ pfx: fs.readFileSync('storekey.pfx'), passphrase: 'storekey' }, app)
    .listen(httpsPort, () => console.log(`booksapp started on https port ${httpsPort}`));
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