"use strict";
(function(){
 const data=window.ATLAS_MOCK,listeners=[];
 const state={screen:"overview",draftCampaigns:data.campaigns.map(c=>Object.assign({},c))};
 function get(){return state}
 function set(patch){Object.assign(state,patch);listeners.forEach(fn=>fn(state))}
 function subscribe(fn){listeners.push(fn)}
 function toast(msg){set({lastToast:{id:Date.now()+Math.random(),msg:msg}})}
 const actions={
  navigate:screen=>set({screen:screen}),
  filterInbox:f=>toast("Gelen kutusu filtrelendi (mock)."),
  confirmAppointment:id=>toast("Randevu "+id+" onaylandı (mock)."),
  cancelAppointment:id=>toast("Randevu "+id+" iptal edildi (mock)."),
  saveDraftCampaign:name=>{if(!name){toast("Kampanya adı boş olamaz (mock).");return}state.draftCampaigns.push({name:name+" (taslak)",audience:"Mock hedefleme",state:"taslak"});toast("Kampanya taslağı kaydedildi (mock). Gönderim yapılmaz.")},
  toggleAutomation:id=>{const item=data.automations.find(x=>x.id===id);if(item)item.active=!item.active;toast("Otomasyon "+id+" durumu değişti (mock).")},
  togglePlugin:id=>{const item=data.plugins.find(x=>x.id===id);if(item)item.installed=!item.installed;toast("Eklenti "+id+" durumu değişti (mock).")},
  triggerHandover:()=>toast("Demo talep oluşturuldu: insan devralma akışı (mock)."),
  saveSettings:()=>toast("Ayarlar kaydedildi (mock). Kalıcı depolama yoktur.")
 };
 window.ATLAS_STORE={get:get,set:set,subscribe:subscribe,actions:actions,data:data};
})();
