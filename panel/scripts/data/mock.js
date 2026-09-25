"use strict";
window.ATLAS_MOCK={
 business:{name:"Demo Klinik A",plan:"Pro (Demo)",city:"İstanbul (Örnek)"},
 kpis:[{label:"Bugünkü randevu",value:"12"},{label:"Bugünkü iptal",value:"2"},{label:"Yoklama",value:"1"},{label:"Açık lead",value:"34"}],
 inbox:[{channel:"WhatsApp (mock)",from:"Demo Müşteri 1",text:"Randevumu erteleyebilir miyim?",risk:"normal"},{channel:"Instagram DM (mock)",from:"Demo Müşteri 2",text:"Fiyat bilgisi alabilir miyim?",risk:"normal"},{channel:"WhatsApp (mock)",from:"Demo Müşteri 3",text:"İşlem sonrası kızarıklık oldu, ne yapmalıyım?",risk:"yüksek"}],
 appointments:[{id:"a1",time:"10:00",customer:"Demo Müşteri 1",service:"Lazer Epilasyon (Örnek)",status:"onaylı"},{id:"a2",time:"11:30",customer:"Demo Müşteri 2",service:"Cilt Bakımı (Örnek)",status:"beklemede"},{id:"a3",time:"14:00",customer:"Demo Müşteri 3",service:"Danışmanlık (Örnek)",status:"iptal"}],
 customers:[{name:"Demo Müşteri 1",phone:"05XX XXX XX 01 (sahte)",leadStatus:"sıcak",source:"Instagram (mock)"},{name:"Demo Müşteri 2",phone:"05XX XXX XX 02 (sahte)",leadStatus:"ılımlı",source:"Web formu (mock)"},{name:"Demo Müşteri 3",phone:"05XX XXX XX 03 (sahte)",leadStatus:"yeni",source:"WhatsApp (mock)"}],
 campaigns:[{name:"Örnek Bahar Kampanyası (taslak)",audience:"Eski müşteriler (mock)",state:"taslak"},{name:"Örnek Doğum Günü İndirimi (taslak)",audience:"Doğum günü olanlar (mock)",state:"taslak"}],
 automations:[{id:"o1",name:"Randevu hatırlatma (mock)",trigger:"Randevudan 24 saat önce",active:true},{id:"o2",name:"Yoklama takibi (mock)",trigger:"Randevu saati geçince",active:false}],
 services:[{name:"Lazer Epilasyon (Örnek)",price:"1.500 TRY (demo)"},{name:"Cilt Bakımı (Örnek)",price:"1.200 TRY (demo)"},{name:"Danışmanlık (Örnek)",price:"Ücretsiz (demo)"}],
 aiSettings:{tone:"Samimi + resmî (demo)",autoReply:"Kapalı (mock)",handoverKeywords:["ağrı","kızarıklık","şişlik"]},
 widget:{theme:"Açık (mock)",position:"Sağ alt (mock)"},
 plugins:[{id:"p1",name:"Google Takvim bağlayıcısı (mock)",installed:false},{id:"p2",name:"CRM eşitleme (mock)",installed:false}],
 analytics:{revenueMonth:"48.000 TRY (demo tahmin)",conversion:"%18 (demo tahmin)",bestService:"Lazer Epilasyon (demo)"},
 team:[{name:"Demo Yönetici",role:"yönetici",perm:"Tüm ekranlar (mock)"},{name:"Demo Personel",role:"personel",perm:"Randevu + gelen kutusu (mock)"}],
 settings:{language:"Türkçe",timezone:"Europe/Istanbul",dataRetention:"KVKK uyumu için taslak (mock)"}
};
