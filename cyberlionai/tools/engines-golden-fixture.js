const path=require('path');
const sc=require(path.join(__dirname, "..", "api", "_lib", "scanner.js"));
function rnd(seed){let x=seed;return()=>{x=(x*1103515245+12345)%2147483648;return x/2147483648;};}
const HV={'strict-transport-security':['max-age=63072000; includeSubDomains','max-age=100',null],
 'content-security-policy':["default-src 'self'","script-src 'unsafe-inline'","script-src 'unsafe-inline' 'nonce-x'; frame-ancestors 'none'",null],
 'x-frame-options':['DENY',null],'x-content-type-options':['nosniff','bad',null],'referrer-policy':['no-referrer',null],
 'permissions-policy':['camera=()',null],'server':['nginx/1.2.3','cloudflare',null],'x-powered-by':['PHP/8.1',null],
 'cross-origin-opener-policy':['same-origin','unsafe-none',null],'cross-origin-embedder-policy':['require-corp',null],
 'cross-origin-resource-policy':['same-site','weird',null],'access-control-allow-origin':['*','https://a.com',null],
 'access-control-allow-credentials':['true',null]};
const COOK=[[],['a=1; Secure; HttpOnly; SameSite=Lax'],['a=1; Secure','b=2; Secure; HttpOnly; SameSite=Lax']];
const HTML=[null,'<html></html>','<img src="http://x.com/a.png"><script src="https://cdn.x/y.js"></script>','<script src="https://cdn.x/y.js" integrity="sha384-x"></script><script src="/l.js"></script>'];
const TLS=[null,{ok:false,reason:'timeout'},{ok:true,protocol:'TLSv1.3',authorized:true,daysLeft:90,issuer:'X'},{ok:true,protocol:'TLSv1.1',authorized:false,authorizationError:'SELF',daysLeft:5},{ok:true,protocol:'TLSv1.2',authorized:true,daysLeft:-2}];
const LEG=[null,{tested:false,reason:'x'},{tested:true,accepted:true},{tested:true,accepted:false}];
const MAIL=[null,{ok:false,sebep:'nxdomain'},{ok:true,spf:['v=spf1 -all'],dmarc:['v=DMARC1; p=reject'],dkimSecici:'google'},{ok:true,spf:[],dmarc:[],dkimJoker:true},{ok:true,spf:['v=spf1 +all'],dmarc:['v=DMARC1; p=none']}];
const DS=[undefined,{ok:true,enabled:true,zone:'a.com'},{ok:false,reason:'not_measured'}];
const out=[];const r=rnd(42);
for(let i=0;i<400;i++){
  const hdr={};for(const k in HV){const v=HV[k][Math.floor(r()*HV[k].length)];if(v!==null)hdr[k]=v;}
  const cookies=COOK[Math.floor(r()*COOK.length)];
  const headers={get:k=>hdr[k]===undefined?null:hdr[k],getSetCookie:()=>cookies};
  const https=r()<0.85;
  const ctx={headers,finalUrl:new URL((https?'https':'http')+'://www.a.com/'),html:HTML[Math.floor(r()*HTML.length)],
    tls:TLS[Math.floor(r()*TLS.length)],legacyTls:LEG[Math.floor(r()*LEG.length)],mail:MAIL[Math.floor(r()*MAIL.length)]};
  const ds=DS[Math.floor(r()*DS.length)]; if(ds!==undefined) ctx.dnssec=ds;
  const checks=sc.buildChecks(ctx);
  out.push({checks,score:sc.scoreOf(checks)});
}
module.exports = JSON.stringify(out);
