const Koa = require('koa');
const cors = require('@koa/cors');
const Router = require('koa-router');
const BodyParser = require("koa-bodyparser");
const logger = require('koa-logger');
const MongoClient = require('mongodb').MongoClient;
const uri = 'mongodb+srv://testuser:testpassword@funkweb-cv-portal-hvkag.gcp.mongodb.net/test?retryWrites=true'

const client = new MongoClient(uri, {useNewUrlParser: true});
const app = new Koa();
const router = new Router();
const dbName = "cv_portal";
const collectionName = "profiles";
var collection;
client.connect().then(async function(){
    collection = client.db(dbName).collection(collectionName);
}).catch((err) => console.log(err));

app.use(logger());
app.use(cors());
app.use(BodyParser());

router.post("/saveCV", saveCV);
router.post("/login", login);
router.post("/newProfile", createProfile);
router.get("/cvMenu", cvMenu);
router.get("/getCV", getCV);
router.post("/delete", deleteCV);
router.post("/deleteAll", deleteAll);
router.get("/fonts", getFonts);

async function GetProfile(profile){
    var res = await collection.findOne({"profile": profile})
    if(res === null) return false;
    return res;
}

async function createProfile(ctx){
    var profileName = ctx.request.body.profile;
    var password = ctx.request.body.password;
    if(profileName.length < 3){ctx.body = {status: false, msg: "Profile name must be at least 3 characters"}; return};
    if(password.length < 4){ctx.body = {status: false, msg: "Password must be at least 4 characters"}; return};
    profile = await GetProfile(profileName); 
    if(profile !== false){ctx.body = {status: false, msg: "Profile already exists"}; return};
    await collection.insertOne({"profile": profileName, "password": password});
    ctx.body = {status: true, msg: "New profile created"}
}

async function login(ctx) {
    var profileName = ctx.request.body.profile;
    var password = ctx.request.body.password;
    profile = await GetProfile(profileName); 
    if(profile == false){ctx.body = {status: false, msg: "Profile not found"}}
    else if(password != profile.password){ctx.body = {status: false, msg: "Incorrect password"}}
    else {ctx.body = {status: true, msg: "Login successfull"}}

}

async function saveCV(ctx){
    var profileObj = {"profile": ctx.request.body.profile};
    var cvObj = {"cvName": ctx.request.body.content.cvName, "content": ctx.request.body.content};
    await collection.updateOne({"profile": ctx.request.body.profile}, {$pull: {"cvList": {"cvName" : ctx.request.body.content.cvName}}});
    await collection.updateOne(profileObj, {$addToSet:{'cvList': cvObj}});
    ctx.body = true;
}

async function cvMenu(ctx){
    profile = await GetProfile(ctx.query.profile);
    if(profile === false){ctx.body = {status: false, msg: "Error: could not find profile " + ctx.query.profile + "'"}; return};
    if(profile.cvList == false){ctx.body = []; return};
    ctx.body = profile.cvList.map(e => e.cvName);
}

async function getCV(ctx){
    profile = (await GetProfile(ctx.query.profile));
    ctx.body = profile.cvList.find(e => e.cvName === ctx.query.cvName);
}

async function deleteCV(ctx){
    await collection.updateOne({"profile": ctx.request.body.profile}, {$pull: {"cvList": {"cvName" : ctx.request.body.cvName}}});
    ctx.body = true;
}

async function deleteAll(ctx){
    await collection.updateOne({"profile": ctx.request.body.profile}, {$set: {"cvList": []}});
    ctx.body = true;
}

async function getFonts(ctx){
    ctx.body = await client.db(dbName).collection("fonts").find().toArray();
}

app.use(router.routes()).use(router.allowedMethods());
app.listen(3000);
console.log("listening on port 3000");

//mongodb+srv://testuser:<testpassword>@funkweb-cv-portal-hvkag.gcp.mongodb.net/test?retryWrites=true