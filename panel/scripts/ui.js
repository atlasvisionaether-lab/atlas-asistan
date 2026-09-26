"use strict";
(function(){
 function el(tag,attrs,children){const node=document.createElement(tag);Object.keys(attrs||{}).forEach(k=>{if(k==="text")node.textContent=attrs.text;else if(k==="class")node.className=attrs.class;else node.setAttribute(k,attrs[k])});(children||[]).forEach(c=>{if(c)node.appendChild(c)});return node}
 function clear(node){while(node.firstChild)node.removeChild(node.firstChild)}
 function table(headers,rows){const t=el("table"),thead=el("thead"),tr=el("tr");headers.forEach(h=>tr.appendChild(el("th",{text:h})));thead.appendChild(tr);t.appendChild(thead);const tbody=el("tbody");rows.forEach(r=>{const row=el("tr");r.forEach(c=>row.appendChild(c&&c.nodeType?c:el("td",{text:String(c)})));tbody.appendChild(row)});t.appendChild(tbody);return t}
 function toast(msg){const root=document.getElementById("toasts");if(!root)return;const item=el("div",{class:"toast",text:msg});root.appendChild(item);setTimeout(()=>item.remove(),3200)}
 function handoverBox(){const box=el("div",{class:"handover"});box.appendChild(el("p",{text:"Bu mesaj sağlık veya şikâyet içeriyor olabilir."}));box.appendChild(el("p",{text:"Ekibimiz kısa süre içinde yardımcı olacak."}));const b=el("button",{class:"btn",text:"İnsan temsilciye aktar (mock)"});b.addEventListener("click",()=>window.ATLAS_STORE.actions.triggerHandover());box.appendChild(b);return box}
 window.ATLAS_UI={el:el,clear:clear,table:table,toast:toast,handoverBox:handoverBox};
})();
