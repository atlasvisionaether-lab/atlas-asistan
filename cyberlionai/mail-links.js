/* mailto: Gmail yedeği + kopyala - CSP uyumlu */
(function(){
  function copy(t){
    if(navigator.clipboard&&navigator.clipboard.writeText){return navigator.clipboard.writeText(t).then(()=>true,()=>false)}
    var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();
    try{var ok=document.execCommand('copy');document.body.removeChild(ta);return Promise.resolve(ok)}catch(e){document.body.removeChild(ta);return Promise.resolve(false)}
  }
  function toast(msg){
    var id='mail-toast';var el=document.getElementById(id);
    if(!el){el=document.createElement('div');el.id=id;el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';document.body.appendChild(el)}
    el.textContent=msg;el.style.opacity='1';clearTimeout(el._t);el._t=setTimeout(()=>el.style.opacity='0',4000)
  }
  function isTr(){return (document.documentElement.lang||'').toLowerCase().startsWith('tr')||navigator.language.toLowerCase().startsWith('tr')}
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href^="mailto:"]');if(!a)return;
    if(e.ctrlKey||e.metaKey||e.shiftKey||e.button===1)return;
    var href=a.getAttribute('href')||'';var to=href.replace(/^mailto:/i,'').split('?')[0].trim();if(!to)return;
    var m=href.match(/[?&]subject=([^&]+)/i);var subject=m?decodeURIComponent(m[1]):'';
    e.preventDefault();
    var url='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(to)+(subject?'&su='+subject:'');
    var win=window.open(url,'_blank');if(win){try{win.opener=null}catch(err){}}
    copy(to).then(function(ok){
      var tr=isTr();
      toast((ok? (tr?'Kopyalandı: ':'Copied: ') : '')+to+(tr?' — Gmail açıldı':' — Gmail opened'));
    });
  });
})();
