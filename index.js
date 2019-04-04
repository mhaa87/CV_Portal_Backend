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
var profileCollection;
var sessionCollection;
client.connect().then(async function(){
    profileCollection = client.db(dbName).collection("profiles");
    sessionCollection = await client.db(dbName).collection("sessions");
    cleanSessions();
}).catch((err) => console.log(err));

app.use(logger());
app.use(cors());
app.use(BodyParser());

router.post("/saveCV", saveCV);
router.post("/login", login);
router.post("/cvMenu", cvMenu);
router.post("/getCV", getCV);
router.post("/getLastCV", getLastCV);
router.post("/delete", deleteCV);
router.post("/deleteAll", deleteAll);
router.get("/fonts", getFonts);

async function GetProfileByEmail(email){
    var res = await profileCollection.findOne({"email": email})
    if(res === null) return false;
    return res;
}

async function GetProfileByKey(key){
    var res = await sessionCollection.findOne({"key": key})
    if(res == null) {return false;}
    res = await GetProfileByEmail(res.email);
    if(res == null) {return false;}
    return res;
}

async function createUser(user){
    if(user.name.length < 3){return {status: false, msg: "Username must be at least 3 characters"}};
    if(user.email.length < 3){return {status: false, msg: "Invalid email address"}};
    if(user.password.length < 7){return {status: false, msg: "Password must be at least 6 characters"}};
    profile = await GetProfileByEmail(user.email); 
    if(profile !== false){return {status: false, msg: "Email address is taken"}};
    await profileCollection.insertOne(user);
    return {status: true, msg: "New profile created", "name": profile.name, "key": await getKey(user, false)}
}

async function login(ctx) {
    var user = ctx.request.body.user;
    if(ctx.request.body.createUser) {ctx.body = await createUser(user); return}
    if(ctx.request.body.key != false && user == false){ctx.body = await keyLogin(ctx.request.body.key);return}
    profile = await GetProfileByEmail(user.email); 
    if(profile == false){ctx.body = {status: false, msg: "Profile does not exist"}; return}
    else if(user.password !== profile.password){ctx.body = {status: false, msg: "Incorrect password"}; return}
    var key = await getKey(user, ctx.request.body.key);
    ctx.body = {"status": true, "msg": "Login successfull", "name": profile.name, "key": key}
}

async function keyLogin(key) {
    var profile = await GetProfileByKey(key);
    if(profile == false){return {status: false, msg: "Session key " + key + " not found"}};
    await sessionCollection.updateOne({"key": key}, {$set: {"expDate": Date.now() + sessionDuration}});
    return {"status": true, "msg": "logged in", "name": profile.name, "key": key};
}

async function getKey(user, key){
    var expDate = Date.now() + sessionDuration;
    if(key != false){
        var profile = await GetProfileByKey(key);
        if(profile != false && profile.email === user.email) {                 
            await sessionCollection.updateOne({"key": key}, {$set: {"expDate": expDate}})
            return key;
        }
    }
    key = randomstring.generate();
    await sessionCollection.insertOne({"key": key, "email": user.email, "expDate": expDate}) 
    return key;
}

async function saveCV(ctx){
    var profile = await GetProfileByKey(ctx.request.body.key);
    var content = ctx.request.body.content;
    await profileCollection.updateOne({"email": profile.email}, {$pull: {"cvList": {"cvName" : content.cvName}}});
    await profileCollection.updateOne({"email": profile.email}, {$addToSet:{'cvList': {"cvName": content.cvName, "content": content}}});
    await profileCollection.updateOne({"email": profile.email}, {$set:{'lastCV': content.cvName}});
    ctx.body = true;
}

async function cvMenu(ctx){
    var profile = await GetProfileByKey(ctx.request.body.key);
    if(profile === false){ctx.body = {status: false, msg: "Error: could not find profile"}; return};
    if(profile.cvList == false || profile.cvList == undefined){ctx.body = []; return};
    ctx.body = profile.cvList.map(e => e.cvName);
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
    ctx.body = true;
}

async function deleteAll(ctx){
    await profileCollection.updateOne({"profile": ctx.request.body.profile}, {$set: {"cvList": []}});
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