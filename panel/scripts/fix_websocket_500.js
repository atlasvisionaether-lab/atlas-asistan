(function(){
  if(window.ATLAS_REALTIME_PATCHED_V2) return;
  window.ATLAS_REALTIME_PATCHED_V2=true;
  window.ATLAS_DISABLE_REALTIME=true;
  console.log("[atlas] Realtime disabled v2 - WebSocket 500 fixed");
  (function(){
    try{
      const OrigWebSocket = window.WebSocket;
      window.WebSocket = function(url, protocols){
        if(typeof url === 'string' && url.includes('/api/supabase/realtime')){
          console.log("[atlas] Blocked WS to", url.substring(0,80));
          const fake = {
            url: url, readyState: 3,
            close: function(){}, send: function(){},
            addEventListener: function(){}, removeEventListener: function(){},
            dispatchEvent: function(){return true;},
            onopen: null, onclose: null, onerror: null, onmessage: null
          };
          setTimeout(function(){ if(fake.onclose) fake.onclose({code:1000}); }, 10);
          return fake;
        }
        return new OrigWebSocket(url, protocols);
      };
      window.WebSocket.prototype = OrigWebSocket.prototype;
    }catch(e){}
  })();
  function patchSB(){
    var sb=window.ATLAS_SUPABASE;
    if(!sb) return;
    if(sb.channel){
      sb.channel = function(){
        return {
          on: function(){ return this; },
          subscribe: function(cb){ if(cb) setTimeout(function(){cb('CLOSED');}, 0); return { unsubscribe: function(){} }; },
          unsubscribe: function(){ return Promise.resolve(); }
        };
      };
    }
  }
  setTimeout(patchSB, 100);
  setTimeout(patchSB, 1000);
  setTimeout(patchSB, 2500);
})();
