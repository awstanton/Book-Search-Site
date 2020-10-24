'use strict';

const argon2 = require('argon2');
const secureRandom = require('secure-random');
//const jwt = require('jsonwebtoken');
const httpsget = require('https').get;
const ObjectId = require('mongodb').ObjectId;
const { v4: uuidv4, validate: uuidValidate } = require('uuid');
const { check, body, validationResult } = require('express-validator');
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: false });
const bodyParser = require('body-parser');
var parseForm = bodyParser.urlencoded({ extended: false });
var natural = require('natural');
const limitFailedAttempts = 5;
const lockedOutInterval = 180000;

module.exports = function handlers(app, dbClient, logger, invertedIndex) {
    var key = secureRandom(256, { type: 'Buffer' });
    var reviewsCollection = dbClient.db("booksapp").collection("reviews");
    var usersCollection = dbClient.db("booksapp").collection("users");

    app.get('/', csrfProtection, (req, res) => {
        // console.log("session " + req.session.id + " in search");
        res.render('index.ejs', { signedIn: req.session.signedIn, username: req.session.username, csrfToken: req.csrfToken() });
    });

    app.get('/results', csrfProtection, (req, res) => {
        // console.log(req.session.searchString);
        if (req.session.searchInfo[0]) {
            res.render('results.ejs', { signedIn: req.session.signedIn, topSortedResults: req.session.topSortedResults, searchString: req.session.searchInfo[0], page: req.session.searchInfo[1], numResults: req.session.searchInfo[2], username: req.session.username, csrfToken: req.csrfToken() });
        }
        else {
            res.render('index.ejs', { signedIn: req.session.signedIn, username: req.session.username, csrfToken: req.csrfToken() });
        }
    });

    app.get('/info/:bookId(\\d+)', async (req, res) => {
        var books = req.session.topSortedResults;
        var book = null;
        var bookId = req.params.bookId;
        var promises = [];
        var renderObject = { signedIn: req.session.signedIn, termsAndPhrases: false, tableOfContents: false, description: false, pageCount: false, rating: false };
        var bookPromise;

        if (books) {
            let index = 0;
            while (index < books.length) {
                if (books[index]._id === Number(bookId)) {
                    book = books[index];
                    break;
                }
                else ++index;
            }
            if (book) {
                renderObject.book = book;
                if (book.isbn)
                    promises.push(getBookData());
                promises.push(getBookRating());
            }
            else {
                bookPromise = getBook();
                promises.push(bookPromise);
                await bookPromise;
                if (book) {
                    if (book.isbn)
                        promises.push(getBookData());
                    promises.push(getBookRating());
                }
            }
        }
        else {
            bookPromise = getBook();
            promises.push(bookPromise);
            await bookPromise;
            if (book) {
                if (book.isbn)
                    promises.push(getBookData());
                promises.push(getBookRating());
            }
        }
        // console.log(promises);
        Promise.all(promises)
        .catch((err) => {
            logger.info({error: err}, "error");
            console.log(err);
        })
        .finally(() => {
            // console.log("in finally after Promise.all");
            // console.log(book);
            if (renderObject.book) {
                book.author = book.author_name || book.contributor || book.author_alternative_name;
                book.date = book.publish_date || book.publish_year;
                if (book.subject)
                    book.subject = book.subject.toString().replace(/,/g, ', ');
                if (book.isbn)
                    book.isbns = book.isbn.toString().replace(/,/g, ', ');
                if (req.session.signedIn)
                    renderObject.username = req.session.username;
                res.render('info.ejs', renderObject);
            }
                
            else
                res.redirect("/");
        });

        function getBook() {
            // console.log("in getBook");
            return new Promise((resolve, reject) => {
                invertedIndex.get('￮' + bookId + '￮')
                .then((doc) => {
                    // console.log(doc);
                    book = renderObject.book = doc;
                })
                .catch((err) => {
                    logger.info({error: err}, "error");
                    console.log(err);
                })
                .finally(() => {
                    // console.log("resolution of getBook");
                    resolve();
                });
            });
        }
        function getBookData() {
            // console.log("in getBookData");
            return new Promise((resolve, reject) => {
                httpsget("https://www.googleapis.com/books/v1/volumes?q=isbn:" + book.isbn[0], (info) => {
                    var data = "";
                    info.on('data', (d) => {
                        data += d;
                    });
                    info.on('end', () => {
                        data.replace(/[=\(\)]/,"");
                        var bookInfo = JSON.parse(data);
                        // console.log(bookInfo);
                        if (bookInfo.totalItems > 0) {
                            renderObject.description = bookInfo.items[0].volumeInfo.description;
                            renderObject.pageCount = bookInfo.items[0].volumeInfo.pageCount;
                        }
                        // console.log("endBookData resolution");
                        resolve();
                    });
                }).on('error', (err) => { console.log(err); logger.info({error: err}, "error"); resolve(); }); // when is this reached? is it only for errors with the actual get?
            });
        }
        function getBookRating() {
            // console.log("in getBookRating");
            return new Promise((resolve, reject) => {
                reviewsCollection.aggregate(
                    [
                        { '$match': { 'bookId': Number(bookId)} },
                        { '$group': { '_id': '$bookId', 'averageRating': {'$avg': '$rating'}} },
                        { '$project': { '_id': 0, 'averageRating': 1 } }
                    ],
                    async (err, cursor) => {
                        // console.log("aggregate callback");
                        // console.log(bookId);
                        if (err) {
                            logger.info({error: err}, "error");
                            console.log(err);
                        }
                        else if (cursor === null)
                            console.log("there are no reviews for this book");
                        else {
                            let ratingDoc = await cursor.next();
                            // console.log(ratingDoc);
                            if (ratingDoc && ratingDoc.averageRating) {
                                renderObject.rating = ratingDoc.averageRating;
                                // console.log(renderObject.rating);
                            }
                        }
                        // console.log("endBookRating resolution");
                        // console.log("rating = " + renderObject.rating);
                        resolve();
                });
            });
        }
    });

    app.get('/reviews/:bookId(\\d+)', async (req, res) => {
        var document, reviews = [], promises = [];
        var bookTitle, bookAuthor, bookDate;
        try {
            let bookDoc = await invertedIndex.get('￮' + req.params.bookId + '￮') // this waits for the then, right?
            if (bookDoc) {
                bookTitle = bookDoc.title_suggest;
                bookAuthor = bookDoc.author_name || bookDoc.contributor || bookDoc.author_alternative_name;
                bookDate = bookDoc.publish_date || bookDoc.publish_year;
            }
        }
        catch(err) {
            logger.info({error: err}, "invalid bookId");
            console.log(err);
            res.redirect("/");
        }

        // console.log("session " + req.session.id + " in reviews");
        // console.log("user signIn status is " + req.session.signedIn);
        if (req.session.signedIn) {
            try {
                const cursor = reviewsCollection.find({ bookId: Number(req.params.bookId) },
                                                  { projection: { userId: 1, date: 1 } });
    
                while (document = await cursor.next()) {
                    let doc = document; // must be let, not var
                    promises.push(usersCollection.findOne({_id: ObjectId(document.userId) })
                                                .then((value) => {
                                                        value.date = doc.date;
                                                        value.reviewId = doc._id;
                                                        return value;
                                                })
                    );
                }
    
                Promise.all(promises)
                   .then((documents) => {
                       for (let i = 0; i < documents.length; ++i) {
                           reviews.push({ username: documents[i].username, date: documents[i].date, reviewId: documents[i].reviewId });
                       }
                       res.render('reviews.ejs', { bookId: req.params.bookId, reviews: reviews, bookTitle: bookTitle, bookAuthor: bookAuthor, bookDate: bookDate, username: req.session.username });
                   })
            }
            catch(err) {
                logger.info({error: err}, "error");
                console.log(err);
                res.redirect('/info/' + req.params.bookId);
            }
        }
        else {
            console.log("user must be signed in to browse reviews");
            res.redirect("/info/" + req.params.bookId);
        }
    });

    async function getTopSortedResults(searchString, page = 1) {
        var terms = searchString.toLowerCase().split(" ").filter((term) => {
            return (term !== "the" && term !== "and" && term !== "or");
        });
        var documentsMap = new Map();
        terms = terms.map((term) => { // all of these will succeed before I convert to array below, right?
            return new Promise((resolve, reject) => {
                invertedIndex.get(term)
                .then((idArray) => {
                    idArray = idArray.map((id) => {
                        return new Promise((resolve_inner, reject_inner) => {
                            invertedIndex.get('￮' + id + '￮')
                            .then((doc) => {
                                documentsMap.set(doc._id, doc);
                                resolve_inner();
                            })
                            .catch((err) => {
                                logger.info({error: err}, "error");
                                console.log(err);
                                resolve_inner();
                            });
                        });
                    });
                    Promise.all(idArray).then(() => { resolve(); });
                })
                .catch((err) => {
                    if (!err.notFound) {
                        logger.info({error: err}, "error");
                        console.log(err);
                    }
                    resolve();
                })
            });
        });
        var documentsArray = [];
        var numDocuments;
        await Promise.all(terms).then(() => {
            documentsArray = Array.from(documentsMap.values());
            for (let document of documentsArray) {
                document.similarity = natural.JaroWinklerDistance(searchString, document.fullTitle);
            }
            documentsArray.sort((doc1, doc2) => {
                if (doc1.similarity > doc2.similarity)
                    return -1;
                else if (doc1.similarity < doc2.similarity)
                    return 1;
                else
                    return 0;
            });
            // console.log(documentsArray.length);
            numDocuments = documentsArray.length;
            documentsArray = documentsArray.slice((page * 100) - 100, (page * 100));
        });
    
        return [documentsArray, numDocuments];
    }

    app.post('/search/:page', parseForm, csrfProtection,
        [
            check('searchString').stripLow().trim()
            .whitelist(" abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890\\!\\@\\#\\%\\^\\*\\-\\_\\+\\,\\.\\;\\:")
            .isLength({ min: 1, max: 350 })
        ],
        (req, res) => {
            // console.log(req.body.searchString);
            const errors = validationResult(req);
            // console.log(errors);
            if (!errors.isEmpty()) {
                // logger.info({error: errors.array()}, "error at " + Date.now());
                return res.status(400).json({ errors: errors.array() });
            }
            var page = (!isNaN(parseFloat(req.params.page)) && isFinite(req.params.page) && req.params.page >= 0) ? req.params.page : 1;
            // console.log("page = " + page);
            // if no session saved, save one for storing results
            // console.log("req.session.id = " + req.session.id);
            // console.log("req.session.signedIn = " + req.session.signedIn);
            if (req.session.signedIn !== true && req.session.signedIn !== false) {
                // console.log('session not saved yet');
                req.session.save(() => {
                    req.session.signedIn = false;
                    // console.log(`saved to the store unauthenticated ${req.session.id}`);
                    getTopSortedResults(req.body.searchString, page)
                    .then((results) => {
                        // console.log(results[1]);
                        req.session.topSortedResults = results[0];
                        // req.session.searchString = req.body.searchString;
                        // req.session = page;
                        // req.session.numResults = results[1];
                        req.session.searchInfo = [req.body.searchString, page, results[1]];
                        //console.log(req.session.topSortedResults);
                        res.render('results.ejs', { signedIn: req.session.signedIn, topSortedResults: req.session.topSortedResults, searchString: req.body.searchString, page: page, numResults: results[1], username: req.session.username, csrfToken: req.csrfToken() });
                    });
                });
            }
            else {
                // console.log('session already saved to store');
                getTopSortedResults(req.body.searchString, page)
                .then((results) => {
                    req.session.topSortedResults = results[0];
                    // req.session.searchString = req.body.searchString;
                    // req.session = page;
                    // req.session.numResults = results[1];
                    req.session.searchInfo = [req.body.searchString, page, results[1]];
                    
                    //console.log(req.session.topSortedResults);
                    res.render('results.ejs', { signedIn: req.session.signedIn, topSortedResults: req.session.topSortedResults, searchString: req.body.searchString, page: page, numResults: results[1], username: req.session.username, csrfToken: req.csrfToken() });
                });
            }
        }
    );

    app.get('/readReview/:bookId(\\d+)/:reviewId', async (req, res) => {
        if (ObjectId.isValid(req.params.reviewId)) {
            if (req.session.signedIn) {
                var bookTitle, bookAuthor, bookDate;
                try {
                    let bookDoc = await invertedIndex.get('￮' + req.params.bookId + '￮') // this waits for the then, right?
                    if (bookDoc) {
                        bookTitle = bookDoc.title_suggest;
                        bookAuthor = bookDoc.author_name || bookDoc.contributor || bookDoc.author_alternative_name;
                        bookDate = bookDoc.publish_date || bookDoc.publish_year;
                    }
                }
                catch(err) {
                    logger.info({error: err}, "invalid bookId");
                    console.log(err);
                    res.redirect("/");
                }
                reviewsCollection.findOne({_id: ObjectId(String(req.params.reviewId)) })
                             .then((document) => {
                                 usersCollection.findOne({_id: ObjectId(document.userId) })
                                                .then((user) => {
                                                    document.username = user.username;
                                                    return document;
                                                })
                                                .then((document) => {
                                                    res.render('readReview.ejs', { review: document, bookId: req.params.bookId, bookTitle: bookTitle, bookAuthor: bookAuthor, bookDate: bookDate, username: req.session.username });
                                                })
                             })
                             .catch((err) => { console.log(err); logger.info({error: err}, "error"); res.redirect('/reviews/' + req.params.bookId); })
            }
            else {
                console.log("user must be signed in to read reviews");
                res.redirect("/info/" + req.params.bookId);
            }
        }
        else {
            console.log("invalid reviewId");
            res.redirect("/info");
        }
    });

    app.get('/writeReview/:bookId(\\d+)', csrfProtection, async (req, res) => {
        if (req.session.signedIn) {
            var bookTitle, bookAuthor, bookDate;
            try {
                var bookDoc = await invertedIndex.get('￮' + req.params.bookId + '￮') // this waits for the then, right?
                if (bookDoc) {
                    bookTitle = bookDoc.title_suggest;
                    bookAuthor = bookDoc.author_name || bookDoc.contributor || bookDoc.author_alternative_name;
                    bookDate = bookDoc.publish_date || bookDoc.publish_year;
                }
            }
            catch(err) {
                logger.info({error: err}, "invalid bookId");
                console.log(err);
                res.redirect("/");
            }

            let time = new Date();
            res.render('writeReview.ejs', { bookId: req.params.bookId, username: req.session.username, date: time.getFullYear() + '-' + (time.getMonth() + 1) + '-' + time.getDate(), bookTitle: bookTitle, bookAuthor: bookAuthor, bookDate: bookDate, csrfToken: req.csrfToken() });
        }
        else {
            console.log("user must be signed in to write reviews");
            res.redirect("/info/" + req.params.bookId);
        }
    });

    app.post('/writeReview/:bookId(\\d+)', parseForm, csrfProtection, [
        check('problem').stripLow().trim().blacklist("\\\\\$\\`<>()={}|&\\\'").isLength({ min: 1, max: 500 }),
        check('rating').isIn([1,2,3,4,5]),
        check('summary').stripLow().trim().blacklist("\\\\\$\\`<>()={}|&\\\'").isLength({ min: 1, max: 500 })
    ], async(req, res) => {
        // console.log(req.body.problem);
        // console.log(req.body.rating);
        // console.log(req.body.summary);
        const errors = validationResult(req);
        console.log(errors);
        if (!errors.isEmpty()) {
            // logger.info({error: errors.array()}, "error at " + Date.now());
            return res.status(400).json({ errors: errors.array() });
        }

        if (req.session.signedIn) {
            // console.log("username: " + req.session.username);

            try {
                let time = new Date();
                // console.log(time);
                // console.log(time.getDate());
                const userResult = await usersCollection.findOne({ username: req.session.username });
                const result = await reviewsCollection.insertOne({ summary: req.body.summary, rating: Number(req.body.rating), problem: req.body.problem, bookId: Number(req.params.bookId), userId: userResult._id, date: time.getFullYear() + '-' + (time.getMonth() + 1) + '-' + time.getDate() });
                res.redirect("/reviews/" + req.params.bookId);
            }
            catch(err) {
                logger.info({error: err}, "error");
                console.log(err);
                // decide what to send back to the user
            }
        }
        else {
            console.log("user must be signed in to write reviews");
            res.redirect("/info");
        }
    });

    app.get('/signIn', csrfProtection, (req, res) => {
        if (!req.session.signedIn) {
            res.render('signIn.ejs', { csrfToken: req.csrfToken() });
        }
        else {
            res.send("already signed in");
        }
    });

    app.post('/signIn', parseForm, csrfProtection, [
        check('username').stripLow().trim().isLength({ min: 8, max: 64 }).isLowercase()
        .isWhitelisted("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#%^*-_+,.;:[]"),
        check('password').stripLow().trim().isLength({ min: 8, max: 64 })
        .isWhitelisted("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#%^*-_+,.;:[]")
    ], async (req, res) => {
        
        if (req.session.signedIn !== true) {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                // logger.info({error: errors.array()}, "error at " + Date.now());
                return res.status(400).json({ "errors": "invalid credentials" });
            }

            // console.log("session " + req.session.id + " in signIn");
            // console.log('session signedIn = ' + req.session.signedIn);

            if (req.body.username !== "" || req.body.password !== "") {
                try {
                    const result = await usersCollection.findOne({ username: req.body.username });
        
                    if (result) {
                        if (result.lockedUntil < Date.now()) {
                            if (await argon2.verify(result.password, req.body.password)) {
                                if (result.failedAttempts > 0) {
                                    await usersCollection.updateOne({ username: req.body.username }, { "$set": { "failedAttempts": 0, "lockedUntil": 0 } });
                                }
    
                                if (req.session.signedIn === false) {
                                    // console.log('before destroying, req.session.id = ' + req.session.id);
                                    var topSortedResults = req.session.topSortedResults;
                                    req.session.regenerate(() => {
                                        // console.log('after regenerating, req.session.id = ' + req.session.id);
                                        req.session.signedIn = true;
                                        req.session.username = result.username;
                                        req.session.topSortedResults = topSortedResults;
                                        res.redirect("/");
                                    });
                                }
                                else {
                                    req.session.signedIn = true;
                                    req.session.username = result.username;
                                    res.redirect("/");
                                }
                            }
                            else {
                                if (result.failedAttempts + 1 >= limitFailedAttempts) {
                                    await usersCollection.updateOne({ username: req.body.username }, { '$set': { "failedAttempts":  limitFailedAttempts, "lockedUntil": Date.now() + lockedOutInterval } });
                                }
                                else {
                                    await usersCollection.updateOne({ username: req.body.username }, { '$set': { "failedAttempts": result.failedAttempts + 1 } });
                                }
                                
                                res.send('failed to sign in');
                            }
                        }
                        else {
                            res.send('too many failed requests');
                        }
                    }
                    else {
                        res.send("invalid username");
                    }
                } catch(err) {
                    logger.info({error: err}, "error");
                    console.error(err);
                    // decide what to send back to the user
                }
            }
        }
        else {
            res.send('already signed in');
        }
    });

    app.get('/signOut', (req, res) => {
        var sessionId = req.session.id;
        req.session.destroy(() => {
            // console.log('destroyed ' + sessionId);
            res.clearCookie('connect.sid');
            res.render('signOut.ejs');
        });
    });

    app.get('/signUp', (req, res) => {
        if (!req.session.signedIn) {
            res.render('signUp.ejs');
        }
        else {
            res.send("cannot sign up while signed in");
        }
        // res.render('signUp.ejs', { csrfToken: req.csrfToken() });
    });

    app.post('/signUp', [
        check('username').stripLow().trim().isLength({ min: 8, max: 64 }).isLowercase()
        .isWhitelisted("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#%^*-_+,.;:[]"),
        check('password').stripLow().trim().isLength({ min: 8, max: 64 })
        .isWhitelisted("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#%^*-_+,.;:[]"),
        check('confirmPassword').stripLow().trim().isLength({ min: 8, max: 64 })
        .isWhitelisted("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890!@#%^*-_+,.;:[]")
    ], async (req, res) => {
        // logger.trace({req: req}, "sign up - request");
        
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // logger.info({error: errors.array()}, "error at " + Date.now());
            return res.status(400).json({ "errors": "invalid input" });
        }

        if (!req.session.signedIn) {
            try {
                if (req.body.username !== "" || req.body.password !== "") {
                    const result = await usersCollection.findOne({ username: req.body.username });
                
                    if (result === null) {
                        if (req.body.password === req.body.confirmPassword) {
                            const hash = await argon2.hash(req.body.password);
                            await usersCollection.insertOne({ username: req.body.username, password: hash, failedAttempts: 0, lockedUntil: 0 });
    
                            res.redirect("/signIn");
                        }
                        else {
                            res.send("passwords do not match");
                        }
                    }
                    else {
                        res.send("try a different username");
                    }
                }
                else {
                    res.send("must specify username and password");
                }
            }
            catch(err) {
                logger.info({error: err}, "error");
                console.log(err);
                res.redirect("/");
            }
        }
        else {
            res.redirect("/");
        }
    });
}


                            // jwt.sign({ username: req.body.username }, key, { algorithm: 'HS256' }, (err, token) => {
                            //     jwt.verify(token, key, { complete: true }, (err, decoded) => {
                            //     });
                            // });