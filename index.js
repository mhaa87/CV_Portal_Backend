const Koa = require('koa');
const cors = require('@koa/cors');
const Router = require('koa-router');
const BodyParser = require("koa-bodyparser");
const logger = require('koa-logger');
const MongoClient = require('mongodb').MongoClient;
const randomstring = require("randomstring");
const uri = 'mongodb+srv://testuser:testpassword@funkweb-cv-portal-hvkag.gcp.mongodb.net/test?retryWrites=true'
const client = new MongoClient(uri, {useNewUrlParser: true});
const app = new Koa();
const router = new Router();
const dbName = "cv_portal";
const sessionDuration = 3 * 24 * 60 * 60 * 1000;
const bcrypt = require('bcrypt');
const saltRounds = 10;
var profileCollection;
var sessionCollection;
var commentCollection;
var databaseConnected = false;

app.use(logger());
app.use(cors());
app.use(BodyParser());

router.use("/", checkConnection);
router.use("/admin", validateAdmin);
router.post("/saveCV", saveCV);
router.post("/login", login);
router.post("/getCV", getCV);
router.post("/getLastCV", getLastCV);
router.post("/delete", deleteCV);
router.post("/deleteAll", deleteAll);
router.post("/addComment", addComment);
router.post("/deleteComment", deleteComment);
router.post("/getComments", getComments);
router.post("/admin/getUsers", getUsers);
router.get("/fonts", getFonts);

async function checkConnection(ctx, next){
    if(databaseConnected === false){
        await client.connect().then(async function(){
            profileCollection = client.db(dbName).collection("profiles");
            sessionCollection = client.db(dbName).collection("sessions");
            commentCollection = client.db(dbName).collection("comments");
            databaseConnected = true;
            // cleanSessions();
            await next();
        }).catch((err) => {console.log(err); ctx.body = {status: false, msg: "Database connection error"};});
    }else{
        await next();
    }
}

async function validateAdmin(ctx, next){
    var profile = await GetProfileByKey(ctx.request.body.key);
    if(profile.admin) await next();
    else ctx.body = {status: false, msg: "Error validating user as admin"};
}

async function addComment(ctx){
    var comment = ctx.request.body;
    comment.date = Date.now();
    ctx.body = await commentCollection.insertOne(comment);
}

async function deleteComment(ctx){
    ctx.body = await commentCollection.remove({date: ctx.request.body});
}

async function getComments(ctx){
    ctx.body = await commentCollection.find().toArray();
}

async function getUsers(ctx){
    ctx.body = await profileCollection.find().project({'_id': 0, 'name': 1, 'email': 1, 'admin': 1}).toArray();
}

async function GetProfileByEmail(email){
    var res = await profileCollection.findOne({"email": email})
    return (res === null) ? false : res;
}

async function GetProfileByKey(key){
    var res = await sessionCollection.findOne({"key": key})
    if(res == null) {return false;}
    res = await GetProfileByEmail(res.email);
    if(res == null) {return false;}
    return res;
}

async function createUser(user, ip){
    if(user.name.length < 3){return {status: false, msg: "Username must be at least 3 characters"}};
    if(user.email.length < 3){return {status: false, msg: "Invalid email address"}};
    if(user.password.length < 6){return {status: false, msg: "Password must be at least 6 characters"}};
    profile = await GetProfileByEmail(user.email); 
    if(profile !== false){return {status: false, msg: "Email address is taken"}};
    user.password = bcrypt.hashSync(user.password, saltRounds);
    await profileCollection.insertOne(user);
    return {status: true, msg: "New profile created", "name": user.name, "key": await getKey(user, ip), "cvList": []}
}

async function login(ctx) {
    // console.log("logging in");
    var user = ctx.request.body.user;
    if(ctx.request.body.createUser) {ctx.body = await createUser(user, ctx.request.ip); return}
    if(ctx.request.body.key != false && user == false){ctx.body = await autoLogin(ctx.request.body.key);return}
    profile = await GetProfileByEmail(user.email); 
    if(profile == false){ctx.body = {status: false, msg: "Profile does not exist"}; return}
    else if(bcrypt.compareSync(user.password, profile.password)){ctx.body = {status: false, msg: "Incorrect password"}; return}
    ctx.body = {"status": true, "msg": "logged in", 
        "name": profile.name, "isAdmin": profile.admin,
        "key": await getKey(user, ctx.request.ip),
        "cvList": profile.cvList,
    }
}

async function autoLogin(key) {
    var profile = await GetProfileByKey(key);
    if(profile == false){return {status: false, msg: "Session key " + key + " not found"}};
    await sessionCollection.updateOne({"key": key}, {$set: {"expDate": Date.now() + sessionDuration}});
    return {"status": true, "msg": "logged in", "name": profile.name, "key": key, "isAdmin": profile.admin, "cvList": profile.cvList,};
}

async function getKey(user, ip){
    var res = await sessionCollection.findOne({$and: [{"email": user.email}, {"ip": ip}]});
    if(res && res.key){
        await sessionCollection.updateOne({"key": res.key}, {$set: {"expDate": Date.now() + sessionDuration}})
        return res.key;
    }
    var key = randomstring.generate();
    await sessionCollection.insertOne({"key": key, "email": user.email, "expDate": Date.now() + sessionDuration, "ip": ip})  
    return key;

}

async function saveCV(ctx){
    var profile = await GetProfileByKey(ctx.request.body.key);
    var content = ctx.request.body.content;
    cvNameCheck(content);
    await profileCollection.updateOne({"email": profile.email}, {$pull: {"cvList": {"cvName" : content.cvName}}});
    await profileCollection.updateOne({"email": profile.email}, {$addToSet:{'cvList': {"cvName": content.cvName, "content": content}}});
    await profileCollection.updateOne({"email": profile.email}, {$set:{'lastCV': content.cvName}});
    ctx.body = (await GetProfileByEmail(profile.email)).cvList;
}

async function cvNameCheck(content){
    if(content.name.length < 1) content.name = "...";
    if(content.cvName.length < 1) content.cvName = "...";
    content.personInfo.forEach((item, i, list) => {if(item.title.length <1) item.title = "..."});
    content.mainContent.forEach((item, i, list) => {
        if(item.title.length <1) item.title = "...";
        if(item.type === 'list') item.items.forEach((listItem, i, list) => {if(listItem.title.length <1) listItem.title = "..."});
    });
}

async function getCV(ctx){
    profile = (await GetProfileByKey(ctx.request.body.key));
    ctx.body = profile.cvList.find(e => e.cvName === ctx.request.body.cvName);
    await profileCollection.updateOne({"email": profile.email}, {$set:{'lastCV': ctx.request.body.cvName}});
}

async function getLastCV(ctx){
    profile = (await GetProfileByKey(ctx.request.body.key));
    if(!profile.lastCV) {ctx.body = false; return}
    ctx.body = profile.cvList.find(e => e.cvName === profile.lastCV);
}

async function deleteCV(ctx){
    var profile = await GetProfileByKey(ctx.request.body.key);
    await profileCollection.updateOne({"email": profile.email}, {$pull: {"cvList": {"cvName" : ctx.request.body.cvName}}});
    ctx.body = (await GetProfileByEmail(profile.email)).cvList.map(e => e.cvName);
}

async function deleteAll(ctx){
    var profile = await GetProfileByKey(ctx.request.body.key);
    console.log(profile);
    await profileCollection.updateOne({"email": profile.email}, {$set: {"cvList": []}});
    ctx.body = true;
}

async function getFonts(ctx){
    ctx.body = await client.db(dbName).collection("fonts").find().toArray();
}

async function cleanSessions(){
    sessionCollection.deleteMany({"expDate": {$lt: Date.now()}});

}

app.use(router.routes()).use(router.allowedMethods());
app.listen(3000);
console.log("listening on port 3000");
//mongodb+srv://testuser:<testpassword>@funkweb-cv-portal-hvkag.gcp.mongodb.net/test?retryWrites=true