(function(){
  if(window.ATLAS_REALTIME_PATCHED) return;
  window.ATLAS_REALTIME_PATCHED=true;
  window.ATLAS_DISABLE_REALTIME=true;
  console.log("[atlas] Realtime disabled, polling enabled - WebSocket 500 fixed");
  function patchSB(){
    var sb=window.ATLAS_SUPABASE;
    if(!sb ||!sb.channel) return;
    sb.channel = function(){
      return { on:function(){return this}, subscribe:function(cb){ if(cb) cb('CLOSED'); return this; }, unsubscribe:function(){return Promise.resolve()} };
    };
  }
  setTimeout(patchSB,500);
  setTimeout(patchSB,2000);
})();
