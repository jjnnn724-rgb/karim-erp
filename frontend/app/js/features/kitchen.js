/**
 * features/kitchen.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// عنقود المخزن + الرفوف + الوزن: نُقل إلى js/features/warehouse.js (يجسر عبر js/main.js — BRIDGE-012)
// ============================================
// KITCHEN & DISPATCH
// ============================================
let kitchenOverviewLoading = false;
async function refreshKitchenOverview(){ if(kitchenOverviewLoading){return;} kitchenOverviewLoading=true; try{STATE.kitchenOps=await apiFetch('/kitchen/overview'); renderPage();}catch(e){toast(e.message||'تعذر تحديث لوحة المطبخ','error')}finally{kitchenOverviewLoading=false;} }
let kitchenProductionRows=[];
let kitchenProductionDestinationsRows=[];
function kitchenProductionDestinations(){
 const rows=[];
 (kitchenProductionDestinationsRows.length?kitchenProductionDestinationsRows:(STATE.departments||[])).filter(d=>String(d.code||'').toLowerCase()!=='kitchen'&&!String(d.name||'').includes('مطبخ')).forEach(d=>rows.push({value:`department|${d.id}|${d.name}`,label:`قسم: ${d.name}`}));
 rows.push({value:'custom|custom|',label:'جهة مخصصة اختيارية'});
 return rows;
}
let kitchenProductionMaterials=[];
let kitchenProductionMaterialRows=[];
async function showKitchenProductionModal(){
 let productsList=[],materialsList=[],destinationsList=[];
 const [productsResult,materialsResult,destinationsResult]=await Promise.allSettled([apiFetch('/pos/products'),apiFetch('/kitchen/production-materials'),apiFetch('/kitchen/production-destinations')]);
 if(productsResult.status==='fulfilled') {productsList=productsResult.value;} else {toast(productsResult.reason?.message||'تعذر تحميل المنتجات النهائية','error');}
 if(materialsResult.status==='fulfilled') {materialsList=materialsResult.value;} else {toast(materialsResult.reason?.message||'تعذر تحميل رصيد مخزن المطبخ','error');}
 if(destinationsResult.status==='fulfilled') {destinationsList=destinationsResult.value;} else {toast(destinationsResult.reason?.message||'تعذر تحميل أقسام التوزيع','error');}
 kitchenProductionMaterials=Array.isArray(materialsList)?materialsList:[];
 kitchenProductionDestinationsRows=Array.isArray(destinationsList)?destinationsList:[];
 const products= (Array.isArray(productsList)?productsList:[]).filter(p=>p.is_active!==false).map(p=>`<option value="${esc(String(p.id))}" data-name="${esc(p.name_ar||p.name_en||'منتج')}" data-unit="${esc(p.unit||'وحدة')}">${esc(p.name_ar||p.name_en||'منتج')} — ${esc(p.unit||'وحدة')}</option>`).join('');
  const destinationOptions=kitchenProductionDestinations();
 kitchenProductionRows=destinationOptions.filter(x=>x.value.startsWith('department|')).slice(0,2).map(x=>({destination:x.value,quantity:''}));
 if(!kitchenProductionRows.length) {kitchenProductionRows=[{destination:'custom|custom|',quantity:''}];}
 kitchenProductionMaterialRows=[{inventory_id:'',quantity:'',waste_percent:'0'}];
 showModal(`<h3><i class=ji data-i=cooking-pot></i> أمر إنتاج وتوزيع المطبخ</h3><p class="text-muted">ثلاث خطوات بالترتيب: المنتج ← المكونات ← التوزيع.</p><div class="wh-step"><span class="wh-stepnum">1</span><div><strong>المنتج النهائي</strong><small class="text-muted" style="display:block">اكتب الاسم يدويًا، أو اختر منتجًا مسجلًا فيملأ الاسم والوحدة تلقائيًا (مستقل عن الوصفة وكتالوج البيع)</small></div></div><div class="fg"><label>اسم المنتج النهائي</label><input type="text" id="kitchenProductionProductName" placeholder="مثال: دجاج مطهي أو صينية لحم"></div><div class="fr"><div class="fg"><label>منتج مسجل اختياري</label><select id="kitchenProductionProduct" data-karim-action="syncKitchenProduct" data-karim-event="change"><option value="">بدون ربط بمنتج مسجل</option>${products}</select></div><div class="fg"><label>الوحدة</label><input type="text" id="kitchenProductionProductUnit" value="وحدة" placeholder="حبة، كجم، صينية..."></div></div><div class="fg"><label>إجمالي الكمية المنتجة</label><input type="number" id="kitchenProductionQty" min="0.01" step="0.01" placeholder="مثال: 50 حبة" data-karim-action="updateKitchenProductionTotal" data-karim-event="input"></div><div class="wh-step"><span class="wh-stepnum">2</span><div><strong>المكونات من مخزن المطبخ</strong><small class="text-muted" style="display:block">مثال: أرز 40 كجم، لحم 20 كجم، هالك 5%.</small></div></div>${kitchenProductionMaterials.length?'':`<div class="callout-gold u-my16"><div class="fw-bold">مخزن المطبخ فارغ — لا توجد أصناف متاحة</div><div class="text-muted u-t12 u-my8">استلم المواد أولًا (من إذن صرف معتمد أو تحويل استثنائي) ثم عُد لإكمال الأمر.</div><div class="u-row-wrap"><button type="button" class="btn btn-gold btn-sm" data-karim-action="showKitchenStockReceiveModal"><i class=ji data-i=inbox></i> استلام مواد الآن</button></div></div>`}<div id="kitchenProductionMaterialRows"></div><button type="button" class="btn btn-blue btn-sm" data-karim-action="addKitchenProductionMaterialRow"><i class=ji data-i=plus></i> إضافة مكون</button><div class="wh-step u-mt12"><span class="wh-stepnum">3</span><div><strong>توزيع المنتج النهائي</strong><small class="text-muted" style="display:block">يجب أن يساوي مجموع التوزيع إجمالي الإنتاج.</small></div></div><div id="kitchenProductionDistributionRows"></div><button type="button" class="btn btn-blue btn-sm" data-karim-action="addKitchenProductionDistributionRow"><i class=ji data-i=plus></i> إضافة جهة</button><div id="kitchenProductionDistributionSummary" class="text-muted u-mt8"></div><div class="fg"><label>ملاحظات الأمر</label><textarea id="kitchenProductionNotes" rows="2" placeholder="وردية الصباح، دفعة الغداء، رقم المناسبة..."></textarea></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="kdSubmitKitchenProduction" ${kitchenProductionMaterials.length?'':'disabled'}>حفظ أمر الإنتاج والتوزيع</button></div>`);
 renderKitchenProductionMaterialRows();renderKitchenProductionRows();
}
// تعبئة تلقائية: اختيار منتج مسجل يملأ الاسم والوحدة (لا يمسح إدخالًا يدويًا)
function syncKitchenProduct(){
const sel=document.getElementById('kitchenProductionProduct');
const opt=sel?.selectedOptions?.[0];
if(!opt||!opt.value) {return;}
const nm=document.getElementById('kitchenProductionProductName');
const un=document.getElementById('kitchenProductionProductUnit');
if(nm&&!nm.value.trim()&&opt.dataset.name){nm.value=opt.dataset.name;}
if(un&&opt.dataset.unit){un.value=opt.dataset.unit;}
}
function setKitchenProductionMaterialField(index,field,value){if(kitchenProductionMaterialRows[index]){kitchenProductionMaterialRows[index][field]=value;}}
function addKitchenProductionMaterialRow(){kitchenProductionMaterialRows.push({inventory_id:'',quantity:'',waste_percent:'0'});renderKitchenProductionMaterialRows();}
function removeKitchenProductionMaterialRow(index){if(kitchenProductionMaterialRows.length<=1){return;}kitchenProductionMaterialRows.splice(index,1);renderKitchenProductionMaterialRows();}
function renderKitchenProductionMaterialRows(){
 const container=document.getElementById('kitchenProductionMaterialRows');if(!container){return;}
 const options=kitchenProductionMaterials.map(m=>`<option value="${esc(String(m.inventory_id))}">${esc(m.name)} — متاح ${fN(m.available)} ${esc(m.unit||'وحدة')}</option>`).join('');
 container.innerHTML=kitchenProductionMaterialRows.map((row,index)=>`<div class="production-distribution-row fr" style="align-items:end;margin-top:8px"><div class="fg"><label>المكون ${index+1}</label><select data-karim-action="setKitchenProductionMaterialField" data-karim-event="change" data-karim-args="[&quot;${index}&quot;,&quot;inventory_id&quot;]" data-karim-pass="value"><option value="">اختر مكونًا من المخزن</option>${options}</select></div><div class="fg"><label>الكمية</label><input type="number" min="0.001" step="0.001" value="${esc(row.quantity||'')}" placeholder="الكمية" data-karim-action="setKitchenProductionMaterialField" data-karim-event="input" data-karim-args="[&quot;${index}&quot;,&quot;quantity&quot;]" data-karim-pass="value"></div><div class="fg"><label>الهالك %</label><input type="number" min="0" max="100" step="0.01" value="${esc(row.waste_percent||'0')}" data-karim-action="setKitchenProductionMaterialField" data-karim-event="input" data-karim-args="[&quot;${index}&quot;,&quot;waste_percent&quot;]" data-karim-pass="value"></div><button type="button" class="btn btn-red btn-sm" data-karim-action="removeKitchenProductionMaterialRow" data-karim-arg0="${index}"><i class=ji data-i=x></i></button></div>`).join('');
 kitchenProductionMaterialRows.forEach((row,index)=>{const select=container.querySelectorAll('select')[index];if(select){select.value=String(row.inventory_id||'');}});
}
function addKitchenProductionDistributionRow(){kitchenProductionRows.push({destination:'channel|custom|',quantity:''});renderKitchenProductionRows();}
function removeKitchenProductionDistributionRow(index){if(kitchenProductionRows.length<=1){return;}kitchenProductionRows.splice(index,1);renderKitchenProductionRows();}
function syncKitchenProductionDestination(select,index){kitchenProductionRows[index].destination=select.value;renderKitchenProductionRows();}
function setKitchenProductionCustomName(index,value){if(kitchenProductionRows[index]){kitchenProductionRows[index].customName=String(value||'').trim();}}
function setKitchenProductionDistributionQty(index,value){if(kitchenProductionRows[index]){kitchenProductionRows[index].quantity=value;}updateKitchenProductionTotal();}
function renderKitchenProductionRows(){
 const container=document.getElementById('kitchenProductionDistributionRows');if(!container){return;}
 const options=kitchenProductionDestinations();
 container.innerHTML=kitchenProductionRows.map((row,index)=>{const selected=String(row.destination||'custom|custom|');const parts=selected.split('|');const isCustom=parts[0]==='custom';return `<div class="production-distribution-row fr" data-row-index="${index}" style="align-items:end;margin-top:8px"><div class="fg"><label>الجهة ${index+1}</label><select class="kitchen-production-destination" data-karim-action="syncKitchenProductionDestination" data-karim-event="change" data-karim-arg0="${index}" data-karim-pass="element">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.label)}</option>`).join('')}</select>${isCustom?`<input class="kitchen-production-custom" type="text" value="${esc(parts[2]||'')}" placeholder="اكتب اسم الجهة" data-karim-action="setKitchenProductionCustomName" data-karim-event="input" data-karim-arg0="${index}" data-karim-pass="value">`:''}</div><div class="fg"><label>الكمية</label><input class="kitchen-production-distribution-qty" type="number" min="0.01" step="0.01" value="${esc(row.quantity||'')}" data-karim-action="setKitchenProductionDistributionQty" data-karim-event="input" data-karim-arg0="${index}" data-karim-pass="value"></div><button type="button" class="btn btn-red btn-sm" data-karim-action="removeKitchenProductionDistributionRow" data-karim-arg0="${index}"><i class=ji data-i=x></i></button></div>`;}).join('');updateKitchenProductionTotal();
}
function updateKitchenProductionTotal(){const total=Number(document.getElementById('kitchenProductionQty')?.value||0),allocated=kitchenProductionRows.reduce((s,r)=>s+Number(r.quantity||0),0),el=document.getElementById('kitchenProductionDistributionSummary');if(el){const diff=Number((total-allocated).toFixed(4));el.innerHTML=`الموزع: <strong>${fN(allocated)}</strong> من <strong>${fN(total)}</strong> ${diff===0?'<span class="c-green"><i class=ji data-i=circle-check></i> مكتمل</span>':`<span class="c-orange">المتبقي: ${fN(diff)}</span>`}`;}}
async function submitKitchenProduction(){
 const productSelect=document.getElementById('kitchenProductionProduct'),productId=productSelect?.value||null,typedProductName=document.getElementById('kitchenProductionProductName')?.value.trim()||'',selectedOption=productSelect?.selectedOptions?.[0],productName=typedProductName||selectedOption?.dataset?.name||'',productUnit=document.getElementById('kitchenProductionProductUnit')?.value.trim()||selectedOption?.dataset?.unit||'وحدة',qty=Number(document.getElementById('kitchenProductionQty')?.value||0),notes=document.getElementById('kitchenProductionNotes')?.value||'';
 if((!productId&&!productName)||qty<=0){toast('اكتب اسم المنتج النهائي والكمية المنتجة','warning');return;}
 const materials=kitchenProductionMaterialRows.map(row=>({inventory_id:Number(row.inventory_id),quantity:Number(row.quantity||0),waste_percent:Number(row.waste_percent||0)})).filter(x=>x.inventory_id&&x.quantity>0);
 if(!materials.length||materials.length!==kitchenProductionMaterialRows.length){toast('أضف كل مكونات أمر الإنتاج وحدد كمياتها','warning');return;}
 if(new Set(materials.map(x=>x.inventory_id)).size!==materials.length){toast('لا تكرر نفس المكون؛ اجمع كميته في سطر واحد','warning');return;}
 if(materials.some(x=>x.waste_percent<0||x.waste_percent>100)){toast('نسبة الهالك يجب أن تكون بين 0 و100%','warning');return;}
 const distributions=kitchenProductionRows.map(row=>{const p=String(row.destination||'').split('|');return {destination_type:p[0],destination_code:p[1],destination_name:p[0]==='custom'?(row.customName||''):p[2],department_id:p[0]==='department'?Number(p[1]):null,quantity:Number(row.quantity||0)};}).filter(x=>x.quantity>0);
 const allocated=distributions.reduce((s,x)=>s+x.quantity,0);if(!distributions.length||Math.abs(allocated-qty)>0.0001){toast(`يجب أن يساوي مجموع التوزيع ${fN(allocated)} إجمالي الإنتاج ${fN(qty)}`,'error');return;}
 if(distributions.some(x=>x.destination_type==='custom'&&!x.destination_name)){toast('اكتب اسم الجهة المخصصة','error');return;}
 try{showLoad();const result=await apiFetch('/kitchen/production',{method:'POST',body:JSON.stringify({product_id:productId?Number(productId):null,product_name:productName,product_unit:productUnit,produced_qty:qty,notes,materials,distributions})});closeModal();await refreshKitchenOverview();toast(`تم تسجيل إنتاج ${fN(qty)} وتوزيعه على ${result.distributions?.length||distributions.length} جهات مع خصم المكونات من مخزن المطبخ`,'success');}catch(e){toast(e.message||'تعذر تسجيل الإنتاج والتوزيع','error')}finally{hideLoad();}
}
let kitchenGovernance={audits:[],documents:[]};
let kitchenGovernanceLoading=false;
async function refreshKitchenGovernance(){if(kitchenGovernanceLoading){return;}kitchenGovernanceLoading=true;try{const [audits,documents]=await Promise.all([apiFetch('/kitchen/audits'),apiFetch('/kitchen/documents')]);kitchenGovernance={audits:Array.isArray(audits)?audits:[],documents:Array.isArray(documents)?documents:[]};renderPage()}catch(e){toast(e.message||'تعذر تحميل مستندات وجرد المطبخ','error')}finally{kitchenGovernanceLoading=false}}
function showKitchenAuditCreateModal(){showModal(`<h3><i class=ji data-i=clipboard-list></i> إنشاء جرد ذكي للمطبخ</h3><p class="text-muted">سيتم التقاط رصيد مخزن المطبخ الحالي كرصيد نظامي، ثم تدخل الكميات الفعلية قبل الإرسال للاعتماد.</p><div class="workflow-banner"><i class=ji data-i=info></i> إذا ظهر «لا توجد أرصدة في مخزن المطبخ»، افتح سجل أذونات الصرف واستلم إذنًا معتمدًا ووقّعه من المطبخ أولًا.</div><div class="fg"><label>دورية الجرد</label><select id="kitchenAuditPeriod"><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly">شهري</option><option value="custom">فترة مخصصة</option><option value="annual">سنوي</option></select></div><div class="fr"><div class="fg"><label>بداية الفترة</label><input type="date" id="kitchenAuditPeriodStart" value="${today()}"></div><div class="fg"><label>نهاية الفترة</label><input type="date" id="kitchenAuditPeriodEnd" value="${today()}"></div></div><div class="fg"><label>ملاحظات</label><textarea id="kitchenAuditNotes" rows="3" placeholder="وردية، سبب الجرد، أسماء فريق العد..."></textarea></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="createKitchenAudit">إنشاء جلسة الجرد</button></div>`)}
async function createKitchenAudit(){try{showLoad();const audit=await apiFetch('/kitchen/audits',{method:'POST',body:JSON.stringify({period:document.getElementById('kitchenAuditPeriod')?.value,period_start:document.getElementById('kitchenAuditPeriodStart')?.value||today(),period_end:document.getElementById('kitchenAuditPeriodEnd')?.value||today(),notes:document.getElementById('kitchenAuditNotes')?.value||''})});closeModal();await refreshKitchenGovernance();openKitchenAuditCount(audit.id)}catch(e){toast(e.message||'تعذر إنشاء الجرد','error')}finally{hideLoad()}}
function openKitchenAuditCount(id){
 const a=(kitchenGovernance.audits||[]).find(x=>String(x.id)===String(id));if(!a){toast('جلسة الجرد غير موجودة','error');return}
 const items=Array.isArray(a.items)?a.items:[];
 const periodLabel=({daily:'يومي',weekly:'أسبوعي',monthly:'شهري',custom:'مخصص',annual:'سنوي'})[a.period]||a.period;
 const start=String(a.period_start||'').slice(0,10),end=String(a.period_end||'').slice(0,10);
 const distributions=(STATE.kitchenOps?.distributions||[]).filter(x=>{const day=String(x.created_at||'').slice(0,10);return (!start||day>=start)&&(!end||day<=end);});
 const distributionMarkup=`<div class="workflow-banner u-mt12"><strong><i class=ji data-i=split></i> حركة الإنتاج والتوزيع خلال الفترة</strong><div class="tbl-scroll u-mt8"><table><thead><tr><th>المنتج</th><th>الجهة</th><th>الكمية</th></tr></thead><tbody>${distributions.map(x=>`<tr><td>${esc(x.product_name||'—')}</td><td>${esc(x.destination_name||x.destination_code||'—')}</td><td class="c-gold fw-bold">${fN(x.allocated_qty)}</td></tr>`).join('')||'<tr><td colspan="3">لا توجد حركة إنتاج موزعة في هذه الفترة</td></tr>'}</tbody></table></div></div>`;
 showModal(`<h3><i class=ji data-i=calculator></i> جرد ${periodLabel} — ${esc(a.audit_number)}</h3><div class="audit-mobile-note">الفترة: ${esc(String(a.period_start||'—'))} إلى ${esc(String(a.period_end||'—'))}. أدخل الكمية الفعلية لكل صنف.</div>${distributionMarkup}<div class="tbl-scroll tbl-sticky-first"><table class="kitchen-audit-table"><thead><tr><th>الصنف</th><th>الرصيد النظامي</th><th>الفعلي</th><th>الفرق</th></tr></thead><tbody>${items.map(x=>`<tr><td class="fw-bold">${esc(x.item_name||'—')}<small class="text-muted"> ${esc(x.unit||'')}</small></td><td>${fN(x.system_qty)}</td><td><input class="kitchen-count-input" data-item-id="${x.id}" type="number" min="0" step="0.001" value="${Number(x.counted_qty||0)}"></td><td class="audit-variance c-gold">${(Number(x.counted_qty||0)-Number(x.system_qty||0)).toFixed(3)}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد أرصدة في مخزن المطبخ</td></tr>'}</tbody></table></div>${a.status==='draft'?signaturePadMarkup('kitchenAuditSubmitSignature','توقيع مسؤول العد والإرسال'):''}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button>${a.status==='draft'?`<button class="btn btn-blue" data-karim-action="saveKitchenAuditCount" data-karim-arg0="${a.id}">حفظ العد</button><button class="btn btn-gold" data-karim-action="submitKitchenAudit" data-karim-arg0="${a.id}">إرسال بتوقيع</button>`:''}</div>`);if(a.status==='draft'){afterModalSignatureInit('kitchenAuditSubmitSignature');}
}
async function saveKitchenAuditCount(id){const items=[...document.querySelectorAll('.kitchen-count-input')].map(x=>({id:Number(x.dataset.itemId),counted_qty:Number(x.value||0)}));try{showLoad();await apiFetch(`/kitchen/audits/${id}/count`,{method:'POST',body:JSON.stringify({items})});await refreshKitchenGovernance();closeModal();toast('تم حفظ كميات الجرد','success')}catch(e){toast(e.message||'تعذر حفظ العد','error')}finally{hideLoad()}}
async function submitKitchenAudit(id){try{showLoad();const items=[...document.querySelectorAll('.kitchen-count-input')].map(x=>({id:Number(x.dataset.itemId),counted_qty:Number(x.value||0)}));await apiFetch(`/kitchen/audits/${id}/count`,{method:'POST',body:JSON.stringify({items})});const signatureData=readSignaturePad('kitchenAuditSubmitSignature');if(!signatureData){return;}const signerName=readSignerName('kitchenAuditSubmitSignature');if(!signerName){return;}await apiFetch(`/kitchen/audits/${id}/submit`,{method:'POST',body:JSON.stringify({signatureData,signerName})});closeModal();await refreshKitchenGovernance();toast('تم إرسال الجرد للاعتماد','success')}catch(e){toast(e.message||'تعذر إرسال الجرد','error')}finally{hideLoad()}}
async function approveKitchenAudit(id){if(!confirm('سيتم تسجيل فروقات الجرد في دفتر المخزون. هل تريد الاعتماد؟')){return;}showModal(`<h3><i class=ji data-i=pen-tool></i> اعتماد جرد المطبخ</h3><div class="workflow-banner">سيتم تطبيق الفروقات في دفتر المخزون ولا يمكن اعتماد الجرد مرة أخرى.</div>${signaturePadMarkup('kitchenAuditApprovalSignature','توقيع مسؤول اعتماد الجرد')}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="confirmKitchenAuditApproval" data-karim-arg0="${id}">اعتماد وتوقيع</button></div>`);afterModalSignatureInit('kitchenAuditApprovalSignature');}
async function confirmKitchenAuditApproval(id){try{showLoad();const signatureData=readSignaturePad('kitchenAuditApprovalSignature');if(!signatureData){return;}const signerName=readSignerName('kitchenAuditApprovalSignature');if(!signerName){return;}await apiFetch(`/kitchen/audits/${id}/approve`,{method:'POST',body:JSON.stringify({signatureData,signerName})});await refreshKitchenGovernance();closeModal();toast('تم اعتماد الجرد وترحيل الفروقات','success')}catch(e){toast(e.message||'تعذر اعتماد الجرد','error')}finally{hideLoad()}}
function renderKitchenGovernance(){const audits=kitchenGovernance.audits||[],docs=kitchenGovernance.documents||[];const canApprove=['admin','manager','auditor'].includes(STATE.currentUser?.role);return `<div class="kitchen-governance-grid"><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> الجرد الذكي</h3><button class="btn btn-gold btn-sm" data-karim-action="showKitchenAuditCreateModal"><i class=ji data-i=plus></i> جرد جديد</button></div><div class="tbl-scroll"><table><thead><tr><th>الرقم</th><th>الدورية والفترة</th><th>الأصناف</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${audits.map(a=>`<tr><td class="fw-bold">${esc(a.audit_number)}</td><td>${({daily:'يومي',weekly:'أسبوعي',monthly:'شهري',custom:'مخصص',annual:'سنوي'})[a.period]||a.period}<small class="text-muted">${a.period_start?`<br>${esc(String(a.period_start))} → ${esc(String(a.period_end||a.period_start))}`:''}</small></td><td>${fN(a.total_items)}</td><td><span class="badge ${a.status==='approved'?'bdg-green':a.status==='submitted'?'bdg-orange':'bdg-blue'}">${a.status==='approved'?'معتمد':a.status==='submitted'?'بانتظار الاعتماد':'مسودة'}</span></td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" data-karim-action="openKitchenAuditCount" data-karim-arg0="${a.id}">عرض/عد</button>${canApprove&&a.status==='submitted'?`<button class="btn btn-green btn-sm" data-karim-action="approveKitchenAudit" data-karim-arg0="${a.id}">اعتماد</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="text-center">لا توجد جلسات جرد بعد</td></tr>'}</tbody></table></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=package></i> مستندات حركة المطبخ</h3><span class="badge bdg-blue">${fN(docs.length)} مستند</span></div><div class="tbl-scroll"><table><thead><tr><th>المستند</th><th>من</th><th>إلى</th><th>التاريخ</th><th>الأصناف</th></tr></thead><tbody>${docs.map(d=>`<tr><td class="fw-bold">#${esc(String(d.id))}</td><td>${esc(d.source_name||'—')}</td><td>${esc(d.destination_name||'—')}</td><td>${fD(d.created_at)}</td><td>${Array.isArray(d.items)?d.items.map(i=>`${esc(i.item_name||'—')} (${fN(i.received_qty||i.requested_qty)})`).join('، '):'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="text-center">لا توجد تحويلات مسجلة للمطبخ</td></tr>'}</tbody></table></div></div></div>`}

let kitchenTransferStock={source:null,destination:null,items:[]};
let kitchenTransferRows=[];
async function showKitchenStockReceiveModal(){
 try{
  const stock=await apiFetch('/kitchen/stock');
  kitchenTransferStock=stock||{source:null,destination:null,items:[]};
 }catch(e){toast(e.message||'تعذر قراءة أرصدة المخزن الرئيسي','error');return;}
 if(!kitchenTransferStock.source||!kitchenTransferStock.destination){toast('موقع المخزن الرئيسي أو مخزن المطبخ غير مهيأ','error');return;}
 kitchenTransferRows=[{inventory_id:'',qty:''}];
 showModal(`<h3><i class=ji data-i=package></i> استلام مواد في مخزن المطبخ</h3><div class="workflow-banner">هذا المسار الإداري مخصص للتحويلات الاستثنائية فقط. المواد المعتادة للمطبخ تدخل من خلال إذن الصرف المعتمد واستلامه بالتوقيع.</div><div class="text-muted" style="margin-bottom:12px">من: <strong>${esc(kitchenTransferStock.source.name_ar||'المخزن الرئيسي')}</strong> ← إلى: <strong>${esc(kitchenTransferStock.destination.name_ar||'مخزن المطبخ')}</strong></div><div id="kitchenTransferRows"></div><button type="button" class="btn btn-blue btn-sm" data-karim-action="addKitchenTransferRow"><i class=ji data-i=plus></i> إضافة صنف</button><div class="fg u-mt16"><label>ملاحظات التحويل</label><textarea id="kitchenTransferNotes" rows="2" placeholder="مثال: تجهيز وردية الغداء"></textarea></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="submitKitchenStockReceive"><i class=ji data-i=inbox></i> استلام المواد</button></div>`);
 renderKitchenTransferRows();
}
function addKitchenTransferRow(){kitchenTransferRows.push({inventory_id:'',qty:''});renderKitchenTransferRows();}
function removeKitchenTransferRow(index){if(kitchenTransferRows.length<=1){kitchenTransferRows[0]={inventory_id:'',qty:''};}else{kitchenTransferRows.splice(index,1);}renderKitchenTransferRows();}
function renderKitchenTransferRows(){
 const container=document.getElementById('kitchenTransferRows');if(!container){return;}
 const options=(kitchenTransferStock.items||[]).map(item=>`<option value="${item.inventory_id}" data-max="${item.available}">${esc(item.name)} — متاح ${fN(item.available)} ${esc(item.unit||'وحدة')}</option>`).join('');
 container.innerHTML=kitchenTransferRows.map((row,index)=>`<div class="kitchen-transfer-row" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px"><div style="flex:2;min-width:220px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الصنف</small><select class="u-input kitchen-transfer-item" data-karim-action="updateKitchenTransferRow" data-karim-event="change" data-karim-args="[&quot;${index}&quot;,&quot;inventory_id&quot;]" data-karim-pass="value" data-karim-also="syncKitchenTransferMax"><option value="">اختر صنفًا من المخزن الرئيسي</option>${options}</select></div><div style="flex:1;min-width:120px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الكمية</small><input class="u-input kitchen-transfer-qty" type="number" min="0.001" step="0.001" value="${row.qty||''}" placeholder="الكمية" data-karim-action="updateKitchenTransferRow" data-karim-event="change" data-karim-args="[&quot;${index}&quot;,&quot;qty&quot;]" data-karim-pass="value"></div><button type="button" class="btn btn-red btn-sm" data-karim-action="removeKitchenTransferRow" data-karim-arg0="${index}" title="حذف"><i class=ji data-i=x></i></button></div>`).join('');
 kitchenTransferRows.forEach((row,index)=>{const select=container.querySelectorAll('.kitchen-transfer-item')[index];if(select){select.value=String(row.inventory_id||'');}const qty=container.querySelectorAll('.kitchen-transfer-qty')[index];if(qty){qty.value=row.qty||'';}});
}
function updateKitchenTransferRow(index,field,value){if(!kitchenTransferRows[index]){return;}kitchenTransferRows[index][field]=field==='qty'?(Number(value)||0):String(value||'');}
function syncKitchenTransferMax(select){const row=select?.closest('.kitchen-transfer-row');const max=Number(select?.options?.[select.selectedIndex]?.dataset?.max||0);const input=row?.querySelector('.kitchen-transfer-qty');if(input){input.max=max||'';if(Number(input.value)>max){input.value=max;}}}
async function submitKitchenStockReceive(){
 const items=kitchenTransferRows.map(row=>({inventory_id:Number(row.inventory_id),qty:Number(row.qty)})).filter(row=>Number.isInteger(row.inventory_id)&&row.inventory_id>0&&row.qty>0);
 if(!items.length){toast('اختر صنفًا وأدخل كمية صحيحة','warning');return;}
 try{showLoad();const result=await apiFetch('/kitchen/transfers/receive',{method:'POST',body:JSON.stringify({source_location_id:kitchenTransferStock.source.id,destination_location_id:kitchenTransferStock.destination.id,reference:`KITCHEN-${uid()}`,notes:document.getElementById('kitchenTransferNotes')?.value.trim()||'',items})});closeModal();await refreshKitchenOverview();await refreshKitchenGovernance();toast(`تم استلام ${fN(result.items?.length||items.length)} صنف في مخزن المطبخ`,'success');}catch(e){toast(e.message||'تعذر استلام مواد المطبخ؛ تحقق من رصيد المخزن الرئيسي','error')}finally{hideLoad();}
}
function renderKitchenDispatchRegister(){
    // أذونات المطبخ + كل الأقسام التابعة له (parent_code=kitchen) — طلب المالك 2026-10-05
    // الشهر الحالي افتراضيًا (طلب المالك 2026-10-08) — إفراغ التاريخ يعرض الكل
    if(window.dispRegFrom===undefined&&window.dispRegTo===undefined){const _m=today().slice(0,8)+'01';window.dispRegFrom=_m;window.dispRegTo=today();}
    const kitchenChildCodes=new Set((STATE.departments||[]).filter(d=>String(d.parent_code||'').toLowerCase()==='kitchen').map(d=>String(d.code||'').toLowerCase()));
    const rows=(STATE.dispatches||[]).filter(d=>{
        const code=String(d.deptCode||d.departmentCode||'').toLowerCase();
        const name=String(d.deptName||d.departmentName||'').toLowerCase();
        if(!(code==='kitchen'||code==='مطبخ'||name.includes('مطبخ')||name.includes('kitchen')||kitchenChildCodes.has(code))){return false;}
        const dd=String(d.date||'').slice(0,10);
        if(window.dispRegFrom&&dd<window.dispRegFrom){return false;}
        if(window.dispRegTo&&dd>window.dispRegTo){return false;}
        return true;
    }).slice().reverse();
    const monthFiltered=window.dispRegFrom||window.dispRegTo;
    const statusLabel={pending:'بانتظار اعتماد المخزن',approved:'معتمد — بانتظار استلام المطبخ',partially_received:'مستلم جزئيًا',received:'مستلم ومغلق',rejected:'مرفوض من الإدارة'};
    const statusClass={pending:'bdg-orange',approved:'bdg-green',partially_received:'bdg-blue',received:'bdg-green',rejected:'bdg-red'};
    return `<div class="tbl-wrap kitchen-dispatch-register"><div class="tbl-hd"><div><h3><i class=ji data-i=clipboard-list></i> أذونات الصرف الواردة للمطبخ والأقسام التابعة له</h3><small class="text-muted">أذونات المطبخ وأقسامه الفرعية بعد اعتماد المخزن: راجع الكميات، ثم سجّل الاستلام بتوقيع مسؤول القسم.${monthFiltered?' <span class="badge bdg-blue">الشهر الحالي</span>':''}</small></div><span class="badge bdg-blue">${fN(rows.length)} إذن</span></div><div class="fr" style="padding:8px 14px;gap:8px;flex-wrap:wrap"><div class="fg"><label>من</label><input type="date" value="${window.dispRegFrom||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="dispRegFrom:@value"></div><div class="fg"><label>إلى</label><input type="date" value="${window.dispRegTo||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="dispRegTo:@value"></div>${monthFiltered?`<button class="btn btn-sm" data-karim-action="renderPage" data-karim-set="dispRegFrom:'',dispRegTo:''">عرض الكل (قديم + جديد)</button>`:''}</div><div class="tbl-scroll"><table><thead><tr><th>الإذن</th><th>القسم</th><th>الأصناف والكميات</th><th>التاريخ</th><th>الحالة</th><th>إجراء المطبخ</th></tr></thead><tbody>${rows.map(d=>`<tr><td class="fw-bold">#${esc(String(d.id))}</td><td><span class="badge bdg-purple">${esc(d.deptName||d.departmentName||'—')}</span></td><td>${(d.items||[]).map(i=>{const cw=i.catchWeightEnabled||i.actualWeight;return `${esc(i.itemName||i.name||'—')} (${fN(i.approvedQty??i.qty)}${cw&&i.packagingQty?` ${esc(i.catchWeightUom||'كجم')} / ${fN(i.packagingQty)} ${esc(i.packagingUom||'كرتون')}`:''})`;}).join('، ')||'—'}</td><td>${fD(d.date)}</td><td><span class="badge ${statusClass[d.status]||'bdg-orange'}">${statusLabel[d.status]||esc(d.status||'غير محدد')}</span>${d.kitchenReceivedBy?`<small class="text-muted" style="display:block;margin-top:4px"><i class=ji data-i=signature></i> ${esc(d.kitchenReceivedBy)}</small>`:''}</td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" data-karim-action="viewDispatchDetails" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=eye></i> عرض</button>${d.status==='approved'&&['admin','manager','kitchen'].includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" data-karim-action="openReceiveModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=inbox></i> استلام وتوقيع</button>`:''}${['approved','partially_received','received'].includes(d.status)?`<button class="btn btn-sm" data-karim-action="printDispatchNote" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد أذونات صرف مسجلة للمطبخ وأقسامه بعد</td></tr>'}</tbody></table></div></div>`;
}
function renderKitchenDistributionRegister(){
 const rows=(STATE.kitchenOps?.distributions||[]).slice();
 const totals={};rows.forEach(r=>{const key=r.destination_name||r.destination_code||'—';totals[key]=(totals[key]||0)+Number(r.allocated_qty||0);});
 const totalCards=Object.entries(totals).map(([name,qty])=>`<span class="badge bdg-blue" style="margin-inline-end:6px">${esc(name)}: ${fN(qty)}</span>`).join('');
 return `<div class="tbl-wrap"><div class="tbl-hd"><div><h3><i class=ji data-i=split></i> توزيع الإنتاج حسب الجهة</h3><small class="text-muted">يوضح أين ذهب كل منتج بعد استهلاكه من مخزن المطبخ.</small></div><div>${totalCards||'<span class="text-muted">لا توجد توزيعات</span>'}</div></div><div class="tbl-scroll"><table><thead><tr><th>المنتج</th><th>الجهة</th><th>النوع</th><th>الكمية</th><th>التاريخ</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="fw-bold">${esc(r.product_name||'—')}</td><td>${esc(r.destination_name||r.destination_code||'—')}</td><td>${r.destination_type==='department'?'قسم':r.destination_type==='channel'?'قناة':'مخصصة'}</td><td class="c-gold fw-bold">${fN(r.allocated_qty)}</td><td>${fD(r.created_at)}</td></tr>`).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد توزيعات إنتاج بعد</td></tr>'}</tbody></table></div></div>`;
}
function renderKitchen(){
 if(!checkMenuAccessLocal('kitchen')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
 const ops=STATE.kitchenOps||{locations:[],batches:[],exceptions:[],policies:[]};
 const policy=ops.policies?.[0]; const modeLabel={flexible:'مرن',monitor:'مراقب',strict:'صارم'}[policy?.operation_mode||'monitor'];
 const pending=STATE.dispatches.filter(d=>d.status==='pending');
 if(!STATE.kitchenOps&&!kitchenOverviewLoading) {setTimeout(refreshKitchenOverview,0);} if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); } if(!kitchenGovernance.audits&&!kitchenGovernanceLoading) {setTimeout(refreshKitchenGovernance,0);}
   return `<div class="kitchen-page"><div class="kitchen-page-head"><div><div class="eyebrow">KITCHEN PRODUCTION CONTROL</div><h3><i class=ji data-i=chef-hat></i> ${t('kit.title')}</h3><p>${t('kit.sub')}</p></div><div class="kitchen-actions"><button class="btn btn-gold" data-karim-action="showDispatchRequestModal"><i class=ji data-i=package></i> ${t('kit.req')}</button><button class="btn btn-blue" data-karim-action="showKitchenProductionModal"><i class=ji data-i=cooking-pot></i> ${t('kit.prod')}</button>${['admin','manager','kitchen','sous_chef'].includes(STATE.currentUser?.role)?`<button class="btn btn-blue" data-karim-action="window.open" data-karim-args="[&quot;/app/menu-admin.html&quot;,&quot;_blank&quot;]" title="الشيف يتحكم في شاشة منيو البوفيه"><i class=ji data-i=settings></i> تحكم شاشة البوفيه</button><button class="btn" data-karim-action="window.open" data-karim-args="[&quot;/app/menu-board.html&quot;,&quot;_blank&quot;]" title="عرض شاشة المنيو على التلفاز"><i class=ji data-i=eye></i> عرض شاشة المنيو</button>`:''}<button class="btn" data-karim-action="refreshKitchenOverview"><i class=ji data-i=refresh></i> ${t('act.refresh')}</button></div></div><div class="metrics-grid kitchen-kpis"><div class="mcard"><div class="mcard-label">${t('kit.policy')}</div><div class="mcard-val c-gold" style="font-size:20px">${modeLabel}</div><small class="text-muted">${t('kit.flexNote')}</small></div><div class="mcard"><div class="mcard-label">${t('kit.openProd')}</div><div class="mcard-val c-blue">${fN((ops.batches||[]).filter(b=>['draft','open'].includes(b.status)).length)}</div></div><div class="mcard"><div class="mcard-label">${t('kit.exceptions')}</div><div class="mcard-val c-orange">${fN((ops.exceptions||[]).length)}</div></div><div class="mcard"><div class="mcard-label">${t('kit.pendingReq')}</div><div class="mcard-val c-purple">${fN(pending.length)}</div></div></div><nav class="wh-secnav" aria-label="أقسام صفحة المطبخ">
<button type="button" class="btn btn-sm" data-sec="kit-sec-prod" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-prod&quot;]"><i class=ji data-i=cooking-pot></i> الإنتاج</button>
<button type="button" class="btn btn-sm" data-sec="kit-sec-dist" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-dist&quot;]"><i class=ji data-i=split></i> التوزيع</button>
<button type="button" class="btn btn-sm" data-sec="kit-sec-cost" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-cost&quot;]"><i class=ji data-i=chart></i> التكلفة</button>
<button type="button" class="btn btn-sm" data-sec="kit-sec-exc" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-exc&quot;]"><i class=ji data-i=alert-triangle></i> الاستثناءات</button>
<button type="button" class="btn btn-sm" data-sec="kit-sec-disp" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-disp&quot;]"><i class=ji data-i=clipboard-list></i> الصرف الوارد</button>
<button type="button" class="btn btn-sm" data-sec="kit-sec-ret" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-ret&quot;]"><i class=ji data-i=undo></i> المرتجعات</button>
<button type="button" class="btn btn-sm" data-sec="kit-sec-pr" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-pr&quot;]"><i class=ji data-i=shopping-cart></i> طلبات الشراء</button>
<button type="button" class="btn btn-sm" data-sec="kit-sec-audit" data-karim-action="kitGoSec" data-karim-args="[&quot;kit-sec-audit&quot;]"><i class=ji data-i=shield-check></i> الجرد</button>
</nav>
<section id="kit-sec-prod" aria-label="أوامر الإنتاج">
<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=cooking-pot></i> أوامر الإنتاج</h3></div><div class="tbl-scroll tbl-sticky-first"><table><thead><tr><th>الوصفة</th><th>الموقع</th><th>المخطط</th><th>المنتج</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${(ops.batches||[]).map(b=>`<tr><td class="fw-bold">${esc(b.product_name||'—')}</td><td>${esc(b.location_name||'—')}</td><td>${fN(b.planned_qty)}</td><td class="c-green">${fN(b.produced_qty)}</td><td class="c-gold">${fN(b.remaining_qty)}</td><td><span class="badge ${b.status==='closed'?'bdg-blue':b.status==='cancelled'?'bdg-red':'bdg-green'}">${b.status==='closed'?'مغلق — موزع':b.status==='cancelled'?'ملغى':'مفتوح'}</span></td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد أوامر إنتاج بعد</td></tr>'}</tbody></table></div></div>
</section>
<section id="kit-sec-dist" aria-label="سجل التوزيع">${renderKitchenDistributionRegister()}</section>
<section id="kit-sec-cost" aria-label="بطاقات التكلفة">${renderCostCardsSection()}</section>
<section id="kit-sec-exc" aria-label="الاستثناءات"><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> استثناءات البيع أو الإنتاج</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السياسة</th><th>السبب</th><th>الحالة</th></tr></thead><tbody>${(ops.exceptions||[]).map(e=>`<tr><td>${esc(e.product_name||'—')}</td><td>${fN(e.quantity)}</td><td>${esc(e.operation_mode)}</td><td>${esc(e.reason)}</td><td><span class="badge bdg-orange">تحتاج مراجعة</span></td></tr>`).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد استثناءات مفتوحة</td></tr>'}</tbody></table></div></div>
</section>
<section id="kit-sec-disp" aria-label="أذونات الصرف الواردة">${renderKitchenDispatchRegister()}</section>
<section id="kit-sec-ret" aria-label="المرتجعات">${renderKitchenReturnsSection()}</section>
<section id="kit-sec-pr" aria-label="طلبات الشراء">${renderPRSection()}</section>
<section id="kit-sec-audit" aria-label="الجرد والحوكمة">${renderKitchenGovernance()}</section>
</div>`;
}
// ═══ Task 19: أدوات سلسلة اعتماد طلبات الصرف (رئيس القسم → الشيف العمومي → المخازن) ═══
// ─── تنقل داخلي لأقسام صفحة المطبخ (صفحة واحدة — تمرير فقط) ────────────────
function kitGoSec(id){
    const el = document.getElementById(id);
    if (el && el.scrollIntoView) {el.scrollIntoView({ behavior: 'smooth', block: 'start' });}
    document.querySelectorAll('.kitchen-page .wh-secnav button').forEach(b => {
        b.classList.toggle('btn-gold', b.dataset.sec === id);
    });
}
const DEPT_CODE_ALIASES = Object.freeze({
    'shop': 'CAF',               // الكوفي شوب (HR) = كافيهshop / الكافيه (مخزن/تشغيل)
    'caf': 'CAF',
    'ca1': 'NAS',                // كافيه ناصر الدور الرابع (HR) = كافيه ناصر (مخزن/تشغيل)
    'nas': 'NAS',
    'juice': 'G',                // العصير (HR) = العصير (مخزن/تشغيل)
    'g': 'G',
    'service': 'hot_hall',        // الصاله (HR) = الصالة (مخزن/تشغيل)
    'hot_hall': 'hot_hall',
    'kitchen': 'kitchen',
    'storeroom': 'storeroom',
    'external_sales': 'external_sales',
});
function canonicalDeptCode(code) {
    if (!code) {return '';}
    const clean = String(code).trim().toLowerCase();
    return DEPT_CODE_ALIASES[clean] || String(code).trim();
}
function myDeptCode(){ return STATE.currentUser?.dept_code || null; }
function isDeptHead(){ return STATE.currentUser?.role==='dept_head'; }
function deptNameByCode(code){
// UPGRADE 2026-10-01 + 2026-10-10: يقبل قائمة أقسام بفواصل والأكواد المتطابقة ويعرض أسماءها
const list=String(code||'').split(',').map(x=>x.trim()).filter(Boolean);
if(!list.length){return '—';}
return list.map(c=>{
    const canon=canonicalDeptCode(c);
    const d=(STATE.departments||[]).find(x=>String(x.code).toLowerCase()===canon.toLowerCase()||String(x.code).toLowerCase()===c.toLowerCase())
         ||(STATE.hrDepartments||[]).find(x=>String(x.code).toLowerCase()===c.toLowerCase()||String(x.code).toLowerCase()===canon.toLowerCase());
    return d?d.name:c;
}).join(' + ');
}
function dispatchChainStage(d){
// المرحلة الحالية من السلسلة لعرضها في الواجهة
if(d.status==='pending') {return d.needsChefApproval?t('stg.chefWait'):t('stg.whWait');}
if(d.status==='chef_approved') {return t('stg.chefDone');}
if(d.status==='approved') {return t('stg.dispensed');}
if(d.status==='partially_received') {return t('stg.partial');}
if(d.status==='received') {return t('stg.received');}
if(d.status==='rejected') {return t('stg.rejected');}
return '—';
}
function renderDeptHeadDashboard(){
const my=myDeptCode();
// Task 28: لوحة القسم الحية — تُجلب مرة واحدة وتُعرض فوق الملخص المحلي فور وصولها
if(STATE.currentUser?.role==='dept_head' && !STATE.deptPanel) {loadDeptPanel();}
const panel=STATE.deptPanel;
const mine=STATE.dispatches.filter(d=>{const codes=String(my||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);return codes.length?codes.includes(String(d.deptCode||'').trim().toLowerCase()):String(d.deptCode)===String(my);});
const pending=mine.filter(d=>d.status==='pending').length;
const chefOk=mine.filter(d=>d.status==='chef_approved').length;
const awaitingReceive=mine.filter(d=>['approved','partially_received'].includes(d.status)).length;
const received=mine.filter(d=>['received','partially_received'].includes(d.status)).length;
const myCost=deptExpenseBreakdown(my).total;
const myDeptName=deptNameByCode(my)||'قسمك';
// طلبات القسم كاملة بلا قص (طلب المالك 2026-10-08): الشهر الحالي افتراضيًا، والكل بزر واحد
if(window.myDispFrom===undefined&&window.myDispTo===undefined&&!window.myDispAll){const _m=today().slice(0,8)+'01';window.myDispFrom=_m;window.myDispTo=today();}
const myShown=window.myDispAll?mine.slice().reverse():mine.filter(d=>{const dd=String(d.date||'').slice(0,10);if(window.myDispFrom&&dd<window.myDispFrom){return false;}if(window.myDispTo&&dd>window.myDispTo){return false;}return true;}).slice().reverse();
// Task 28: بطاقات مصادر الكلفة من الخادم الحي (صرف مخزني / عكس صرف / فروق جرد / يدوي)
let panelHtml='';
if(panel && panel.scope && String(panel.scope.deptCode||'')===String(my||'')){
const src=panel.expenses?.bySource||{};
const labels=panel.expenses?.labels||{};
const card=(key,icon,_colorCls)=>{const row=src[key];const total=row?row.total:0;const cnt=row?row.count:0;return `<div class="metric-card-premium"><div class="kpi-top"><span class="kpi-label">${esc(labels[key]||key)}</span><span class="kpi-chip"><i class=ji data-i=${icon}></i></span></div><div class="value ${total<0?'c-red':''}">${fC(total)}</div><div class="trend"><i class=ji data-i=chart></i> ${cnt} حركة</div></div>`;};
const sourcesHtml=['dispatch','dispatch_return','stocktaking','manual'].map(k=>card(k, k==='dispatch'?'package':k==='dispatch_return'?'undo':k==='stocktaking'?'clipboard-list':'wallet')).join('');
const subDepts=Array.isArray(panel.subDepartments)?panel.subDepartments:[];
panelHtml=`
<div class="u-row-between" style="margin-top:22px"><h3 class="u-gold-strong"><i class=ji data-i=chart></i> كلفة ${esc(panel.department?.name||myDeptName)} حسب المصدر</h3><span class="badge bdg-blue"><i class=ji data-i=activity></i> مباشر من الخادم</span></div>
<div class="stats-grid-premium kpi-grid-4">${sourcesHtml}</div>
${subDepts.length?`<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=building></i> الأقسام التابعة</h3></div><div class="tbl-scroll"><table><thead><tr><th>القسم</th><th>الكود</th></tr></thead><tbody>${subDepts.map(s=>`<tr><td>${esc(s.name)}</td><td class="mono">${esc(s.code)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
<div class="text-muted" style="margin-top:8px;font-size:12px">إجمالي كلفة النطاق: <strong class="c-gold">${fC(panel.expenses?.total||0)}</strong> — محدث عند ${esc(String(panel.generatedAt||'').slice(11,19)||'—')}</div>`;
}
return `
<div class="workflow-banner" style="margin-bottom:18px"><i class=ji data-i=chef-hat></i> لوحة رئيس القسم: <strong>${esc(myDeptName)}</strong> — تنشئ طلب الصرف، يعتمده <strong>الشيف العمومي</strong>، ثم تصرفه <strong>المخازن</strong>، ويستلمه قسمك من مخزنه الخاص.</div>
<div class="stats-grid-premium kpi-grid-4">
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;dispatch&quot;]"><div class="kpi-top"><span class="kpi-label">طلباتي بانتظار الشيف</span><span class="kpi-chip"><i class=ji data-i=hourglass></i></span></div><div class="value">${pending}</div><div class="trend"><i class=ji data-i=clipboard-list></i> من إجمالي ${mine.length} طلب</div></div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;dispatch&quot;]"><div class="kpi-top"><span class="kpi-label">معتمدة بانتظار المخازن</span><span class="kpi-chip"><i class=ji data-i=circle-check></i></span></div><div class="value">${chefOk}</div><div class="trend"><i class=ji data-i=package></i> جاهزة للصرف</div></div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;dispatch&quot;]"><div class="kpi-top"><span class="kpi-label">بانتظار استلام قسمي</span><span class="kpi-chip"><i class=ji data-i=inbox></i></span></div><div class="value">${awaitingReceive}</div><div class="trend"><i class=ji data-i=archive></i> تُستلم في مخزن القسم</div></div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;dispatch&quot;]"><div class="kpi-top"><span class="kpi-label">كلفة قسمي (الإجمالي)</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div><div class="value">${fC(myCost)}</div><div class="trend"><i class=ji data-i=chart></i> مستلمة: ${received} طلب</div></div>
</div>
${panelHtml}
<div class="u-row-between" style="margin-top:22px"><h3 class="u-gold-strong"><i class=ji data-i=clipboard-list></i> طلبات ${esc(myDeptName)}${window.myDispAll?' <span class="badge bdg-blue">الكل</span>':' <span class="badge bdg-blue">الشهر الحالي</span>'}</h3><button class="btn btn-gold" data-karim-action="showDispatchRequestModal"><i class=ji data-i=plus></i> طلب صرف جديد</button></div>
<div class="fr" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="fg"><label>من</label><input type="date" value="${window.myDispFrom||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="myDispFrom:@value,myDispAll:false"></div><div class="fg"><label>إلى</label><input type="date" value="${window.myDispTo||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="myDispTo:@value,myDispAll:false"></div>${window.myDispAll?`<button class="btn btn-sm" data-karim-action="kitchenResetDisp">الشهر الحالي فقط</button>`:`<button class="btn btn-sm" data-karim-action="renderPage" data-karim-set="myDispFrom:'',myDispTo:'',myDispAll:true">عرض الكل (قديم + جديد)</button>`}<span class="badge bdg-blue">${fN(myShown.length)} طلب</span></div>
<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>#</th><th>الأصناف</th><th>التاريخ</th><th>المرحلة</th><th>الحالة</th></tr></thead><tbody>${myShown.map(d=>`<tr><td>${esc(String(d.id)).slice(-6)}</td><td>${(d.items||[]).map(i=>`${esc(i.itemName)} (${fN(i.qty)})`).join('، ')}</td><td>${fD(d.date)}</td><td>${esc(dispatchChainStage(d))}</td><td><span class="badge ${dispatchStatusClass(d.status)}">${dispatchStatusLabel(d.status)}</span></td></tr>`).join('')||'<tr><td colspan="5" class="u-empty">لا توجد طلبات في الفترة — أفرغ التاريخ لعرض الكل أو أنشئ طلبك الأول</td></tr>'}</tbody></table></div></div>`;
}
// Task 28: جلب لوحة القسم الحية — صامتة عند الفشل (اللوحة تعمل بالبيانات المحلية)
async function loadDeptPanel(){
try{
STATE.deptPanel = await apiFetch('/warehouse/dept-panel');
if(STATE.page==='dashboard') {renderPage();}
}catch(e){ console.warn('dept-panel:', e.message); }
}
function renderDispatch(){
if(!checkMenuAccessLocal('dispatch')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); }
const role=STATE.currentUser?.role; const my=myDeptCode();
// الشهر الحالي افتراضيًا (طلب المالك 2026-10-08) — إفراغ التاريخ يعرض الكل
if(window.dispFrom===undefined&&window.dispTo===undefined){const _m=today().slice(0,8)+'01';window.dispFrom=_m;window.dispTo=today();}
// رئيس القسم يرى طلبات قسمه فقط — باقي الأدوار ترى الكل
const dispatches = [...STATE.dispatches].reverse().filter(d=>{if(!isDeptHead()){return true;}const codes=String(my||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);return codes.length?codes.includes(String(d.deptCode||'').trim().toLowerCase()):String(d.deptCode)===String(my);}).filter(d=>{const dd=String(d.date||'').slice(0,10);if(window.dispFrom&&dd<window.dispFrom){return false;}if(window.dispTo&&dd>window.dispTo){return false;}return true;});
const monthFiltered=window.dispFrom||window.dispTo;
const chefQueue=dispatches.filter(d=>d.status==='pending'&&d.needsChefApproval).length;
const warehouseQueue=dispatches.filter(d=>d.status==='chef_approved'||(d.status==='pending'&&!d.needsChefApproval)).length;
const chainBanner=!isDeptHead()?`<div class="workflow-banner" style="margin-bottom:14px"><i class=ji data-i=clipboard-list></i> سلسلة الاعتماد: <strong>رئيس القسم</strong> ينشئ الطلب ← <strong>الشيف العمومي</strong> يعتمده ← <strong>المخازن</strong> تصرف وتخصم ← القسم يستلم من مخزنه الخاص.</div>`:'';
const canDecideChef=['admin','manager','kitchen','sous_chef'].includes(role);
const canDecideWarehouse=['admin','manager','warehouse'].includes(role);
const canReceive=['admin','manager','kitchen','sous_chef'].includes(role);
return `<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=clipboard-list></i> ${t('pg.dispatch')}${isDeptHead()?` — ${esc(deptNameByCode(my))}`:''}${monthFiltered?' <span class="badge bdg-blue">الشهر الحالي</span>':''}</h3><button class="btn btn-gold" data-karim-action="showDispatchRequestModal"><i class=ji data-i=package></i> ${t('dsp.new')}</button></div>${chainBanner}<div class="fr" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="fg"><label>من</label><input type="date" value="${window.dispFrom||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="dispFrom:@value"></div><div class="fg"><label>إلى</label><input type="date" value="${window.dispTo||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="dispTo:@value"></div>${monthFiltered?`<button class="btn btn-sm" data-karim-action="renderPage" data-karim-set="dispFrom:'',dispTo:''">عرض الكل (قديم + جديد)</button>`:''}</div>${canDecideChef||canDecideWarehouse?`<div class="fr u-mb12"><span class="badge bdg-orange"><i class=ji data-i=chef-hat></i> ${t('dsp.chefWait')}: ${chefQueue}</span><span class="badge bdg-blue"><i class=ji data-i=package></i> ${t('dsp.whWait')}: ${warehouseQueue}</span></div>`:''}<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> ${isDeptHead()?t('dsp.mine'):t('dsp.all')}</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="dispPrintList"><i class=ji data-i=printer></i> طباعة الكشف</button></div></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>${t('dsp.dept')}</th><th>${t('dsp.items')}</th><th>${t('dsp.date')}</th><th>${t('dsp.stage')}</th><th>${t('dsp.status')}</th><th>${t('dsp.by')}</th><th>${t('dsp.actions')}</th></tr></thead><tbody>${dispatches.map((d,idx)=>{const canWarehouse=d.status==='pending'&&!d.needsChefApproval||d.status==='chef_approved';return `<tr><td>${idx+1}</td><td class="fw-bold">${esc(d.deptName)}</td><td>${(d.items||[]).map(i=>`${esc(i.itemName)} (${fN(i.qty)})`).join(', ')}</td><td>${fD(d.date)}</td><td>${esc(dispatchChainStage(d))}</td><td><span class="badge ${dispatchStatusClass(d.status)}">${dispatchStatusLabel(d.status)}</span></td><td>${esc(d.createdBy||'—')}${d.creatorRole==='dept_head'?' <span class="badge bdg-purple">رئيس قسم</span>':''}</td><td style="display:flex;gap:6px;flex-wrap:wrap">${d.status==='pending'&&d.needsChefApproval&&canDecideChef?`<button class="btn btn-green btn-sm" data-karim-action="openChefApproveModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=chef-hat></i> اعتماد الشيف</button><button type="button" class="btn btn-red btn-sm" data-karim-action="openChefRejectModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=circle-x></i> رفض الشيف</button>`:''}${canWarehouse&&canDecideWarehouse&&!['rejected'].includes(d.status)?`<button class="btn btn-green btn-sm" data-karim-action="openApproveModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=circle-check></i> اعتماد المخازن</button><button type="button" class="btn btn-red btn-sm" data-karim-action="openRejectModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=circle-x></i> رفض وتوقيع</button>`:''}${((d.status==='pending'&&canDecideWarehouse)||role==='admin')?`<button type="button" class="btn btn-sm ${role==='admin'&&d.status!=='pending'?'btn-red':''}" data-karim-action="deleteDispatch" data-karim-arg0="${esc(String(d.id))}" data-karim-arg1="${esc(String(d.status))}" title="${role==='admin'?'حذف نهائي للأدمن (أي حالة — موثّق باسمك)':'حذف طلب معلّق لم يُعتمد بعد'}"><i class=ji data-i=trash></i> ${role==='admin'&&d.status!=='pending'?'حذف نهائي (أدمن)':'حذف'}</button>`:''}${d.status==='approved'&&(canReceive||(isDeptHead()&&String(d.deptCode)===String(my)))?`<button type="button" class="btn btn-gold btn-sm" data-karim-action="openReceiveModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=inbox></i> استلام وتوقيع</button>`:''}${canEditDispatch(d)?`<button type="button" class="btn btn-blue btn-sm" data-karim-action="openDispatchEditModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=pencil></i> تعديل</button>`:''}<button type="button" class="btn btn-blue btn-sm" data-karim-action="viewDispatchDetails" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=eye></i> عرض</button>${['approved','partially_received','received'].includes(d.status)?`<button type="button" class="btn btn-sm" data-karim-action="printDispatchNote" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="8" class="u-empty">لا توجد طلبات</td></tr>'}</tbody></table></div></div>${renderKitchenReturnsSection()}`;
}
// ═══ طلبات شراء النواقص: بيتها المخزن — أمين المخزن ينشئ ← الشيف يوقّع ← المدير العام يعتمد ← المخزن يستلم ═══
// (2026-10-01 بطلب المالك: الإنشاء من المخزن حصرًا — kitchen/dept_head للعرض والاعتماد فقط)
function dispPrintList(){
const rows=(STATE.dispatches||[]).filter(d=>{const dd=String(d.date||'').slice(0,10);if(window.dispFrom&&dd<window.dispFrom){return false;}if(window.dispTo&&dd>window.dispTo){return false;}return true;}).slice().reverse();
const body=rows.map((d,i)=>`<tr><td>${rows.length-i}</td><td>${esc(d.deptName||'—')}</td><td>${(d.items||[]).map(x=>`${esc(x.itemName)} (${fN(x.approvedQty??x.qty)})`).join('، ')}</td><td>${fD(d.date)}</td><td>${esc(d.status||'—')}</td></tr>`).join('');
ysPrintReport('كشف أذونات الصرف', `${window.dispFrom||window.dispTo?`من ${window.dispFrom||'البداية'} إلى ${window.dispTo||'اليوم'}`:'كل الفترة'}`,
[['عدد الأذون', fN(rows.length)]], ['#','القسم','الأصناف','التاريخ','الحالة'], body);
}
function prCanSee(){ return ['admin','manager','warehouse','kitchen','sous_chef','accountant'].includes(STATE.currentUser?.role); }
function prCanCreate(){ return ['admin','manager','warehouse','kitchen','sous_chef'].includes(STATE.currentUser?.role); }
// الشيف ينشئ الطلب موقّعًا من نفسه — يدخل المخزن مباشرة دون مرحلة توقيع شيف آخر
function prIsChefCreator(){ return ['kitchen','sous_chef'].includes(STATE.currentUser?.role); }
function prCanReceive(){ return ['admin','manager','warehouse'].includes(STATE.currentUser?.role); }
function prCanChef(){ return ['admin','manager','kitchen','sous_chef'].includes(STATE.currentUser?.role); }
function prCanGM(){ return ['admin','manager'].includes(STATE.currentUser?.role); }
function prCanCancel(){ return ['admin','manager','warehouse','kitchen','sous_chef'].includes(STATE.currentUser?.role); }
function prCanDelete(){ return ['admin','manager'].includes(STATE.currentUser?.role); }
async function deletePR(id){
if(!prCanDelete()){ toast('حذف طلبات الشراء للإدارة فقط','error'); return; }
if(!confirm('حذف نهائي لهذا الطلب؟ لا يمكن التراجع.')) {return;}
try{ showLoad();
await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}`,{method:'DELETE'});
STATE.purchaseRequests=(STATE.purchaseRequests||[]).filter(x=>String(x.id)!==String(id));
closeModal(); renderPage(); toast('حُذف الطلب نهائيًا','info');
}catch(e){ toast(e.message||'تعذر حذف الطلب','error'); }
finally{ hideLoad(); }
}
async function deleteDispatch(id, forceStatus){
const role = STATE.currentUser?.role;
const dSelf=(STATE.dispatches||[]).find(x=>String(x.id)===String(id));
const isCreatorPending = dSelf && String(dSelf.creatorUserId||'')===String(STATE.currentUser?.id||'') && dSelf.status==='pending';
if(!['admin','manager','warehouse'].includes(role) && !isCreatorPending){ toast('الحذف للمخازن والإدارة أو صاحب الطلب المعلّق','error'); return; }
const isAdmin = role === 'admin';
const isSigned = forceStatus && forceStatus !== 'pending';
if(isAdmin && isSigned){
if(!confirm('⚠️ حذف نهائي لإذن صرف ' + forceStatus + ' ؟\nهذا مستند مالي موقّع — سيُحذف نهائيًا ويُوثّق باسمك في سجل الأدمن.\nهل أنت متأكد؟')) {return;}
}else{
if(!confirm('حذف طلب الصرف المعلق نهائيًا؟ (المعتمد/المستلم لا يُحذف إلا بواسطة الأدمن — حذف نهائي موثّق)')) {return;}
}
try{ showLoad();
await apiFetch(`/dispatches/${encodeURIComponent(id)}`, { method: 'DELETE' });
STATE.dispatches=(STATE.dispatches||[]).filter(x=>String(x.id)!==String(id));
closeModal(); renderPage(); toast(isAdmin && isSigned ? 'حُذف إذن الصرف نهائيًا (موثّق باسم الأدمن)' : 'حُذف طلب الصرف المعلق','info');
}catch(e){ toast(e.message||'تعذر حذف طلب الصرف','error'); }
finally{ hideLoad(); }
}
// ─── تعديل إذن الصرف قبل اعتماد المخازن (طلب المالك 2026-10-04) ───
function canEditDispatch(d){
if(!d||!['pending','chef_approved'].includes(d.status)){return false;}
const role=STATE.currentUser?.role;
if(['kitchen','sous_chef','admin','manager'].includes(role)){return true;}
// قرار المالك 2026-10-09: رئيس القسم يعدّل أذونات قسمه (تظهر في حسابه)
if(role==='dept_head'){
const myDepts=String(STATE.currentUser?.dept_code||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
if(myDepts.includes(String(d.deptCode||'').trim().toLowerCase())){return true;}
}
return String(d.creatorUserId||'')===String(STATE.currentUser?.id||'');
}
// ─── تعديل إذن الصرف قبل اعتماد المخازن (طلب المالك 2026-10-04) ───
// نفس شاشة الإنشاء بالضبط: بحث فوري من المخزن + الإضافة بتصنيفه ووحداته + عرض المتاح.
function dispatchEditRowHtml(){ return dispRowHtml(); }
function prefillDispatchEditRow(row, it){
if(!row){return;}
const inv=(STATE.inventory||[]).find(i=>String(i.name||'').toLowerCase()===String(it.itemName||'').toLowerCase());
if(inv){
// نفس مصدر شاشة الإنشاء: رصيد الرئيسي المؤكد أولًا، ثم الإجمالي كاحتياطي
const confirmedMax = dispatchMainAvail ? (dispatchMainAvail.get(Number(inv.id)) ?? 0) : (inv.qty ?? 0);
const synthetic=document.createElement('div');
synthetic.setAttribute('data-name', inv.name||it.itemName);
synthetic.setAttribute('data-unit', inv.unit||'قطعة');
synthetic.setAttribute('data-max', confirmedMax);
synthetic.setAttribute('data-catch', inv.catch_weight_enabled?1:0);
synthetic.setAttribute('data-pkguom', inv.packaging_uom||'كرتون');
synthetic.setAttribute('data-avgbox', inv.packaging_qty_per_base??'');
synthetic.setAttribute('data-secunits', esc(JSON.stringify(Array.isArray(inv.secondary_units)?inv.secondary_units.filter(u=>u&&u.uom&&Number(u.factor)>0):[])));

const nameBanner=document.createElement('div');
nameBanner.style.cssText='font-size:15px;font-weight:900;margin-bottom:8px;color:var(--text);display:flex;align-items:center;gap:6px';
nameBanner.innerHTML='<i class=ji data-i=package></i> '+esc(it.itemName||'');
row.insertBefore(nameBanner, row.firstChild);
row.querySelector('.dispatch-item-list').appendChild(synthetic);
dispPickItem(synthetic);
synthetic.remove();
}else{
// الصنف لم يعد موجودًا في المخزن — يبقى نصًا مع تنبيه واضح بدل إسقاطه
row.querySelector('.dispatch-item-search').value=it.itemName||'';
row.querySelector('.dispatch-item-name').value=it.itemName||'';
row.querySelector('.row-unit').textContent=it.unit||'وحدة';
const av=row.querySelector('.row-avail'); if(av){av.textContent='⚠ الصنف غير موجود في المخزن حاليًا';}
}
const isCw=row.querySelector('.dispatch-item-catch')?.value==='1';
if(isCw){
const pkg=row.querySelector('.dispatch-item-pkg'); if(pkg){pkg.value=it.packagingQty??it.qty??'';}
const qty=row.querySelector('.dispatch-item-qty'); if(qty&&it.estWeightKg){qty.value=it.estWeightKg;}
}else{
const qty=row.querySelector('.dispatch-item-qty'); if(qty){qty.value=it.requestedQty??it.qty??'';}
const uomSel=row.querySelector('.dispatch-item-uom');
if(uomSel&&it.requestedUom){ const opt=[...uomSel.options].find(o=>o.value===it.requestedUom); if(opt){uomSel.value=it.requestedUom;} }
}
}
function openDispatchEditModal(id){
const d=(STATE.dispatches||[]).find(x=>String(x.id)===String(id));
if(!d){toast('الطلب غير موجود','error');return;}
if(!canEditDispatch(d)){toast('التعديل متاح قبل اعتماد المخازن فقط','error');return;}
// تحميل أرصدة الرئيسي أولًا (كانت مفقودة في التعديل — البحث والمتاح كانا مكسورين)
showModal(`<h3><i class=ji data-i=pencil></i> تعديل إذن الصرف — ${esc(d.deptName||'')}</h3><div class="text-muted u-p8">جارٍ حساب أرصدة المخزن الرئيسي...</div>`);
loadDispatchMainAvailability().then((ok)=>{
if(!ok){
showModal(`<h3><i class=ji data-i=pencil></i> تعديل إذن الصرف — ${esc(d.deptName||'')}</h3><div class="workflow-banner" style="color:var(--red,#d64545)"><i class=ji data-i=alert-triangle></i> <strong>تعذر جلب أرصدة المخزن الرئيسي</strong> — سيُعرض المتاح من البيانات المحلية، والبحث عن أصناف جديدة قد لا يعمل. حدّث الصفحة لو تكرر.</div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button><button class="btn btn-gold" data-karim-action="openDispatchEditModal" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=refresh></i> إعادة المحاولة</button></div>`);
return;
}
openDispatchEditModalReady(d);
});
}
function openDispatchEditModalReady(d){
const isDeptHeadEditor=STATE.currentUser?.role==='dept_head';
const deptOptions=getDispatchDepartments().map((dep)=>`<option value="${esc(dep.code)}" ${String(dep.code).toLowerCase()===String(d.deptCode||'').toLowerCase()?'selected':''}>${esc(dep.name||dep.name_ar||dep.code)}</option>`).join('');
const deptField=isDeptHeadEditor
 ? `<div class="fg"><label>القسم الطالب</label><input type="text" value="${esc(deptNameByCode(d.deptCode)||d.deptCode||'')}" readonly disabled></div>`
 : `<div class="fg"><label>القسم الطالب (يمكن نقله لقسم آخر)</label><select id="deDept">${deptOptions}</select></div>`;
showModal(`<h3><i class=ji data-i=pencil></i> تعديل إذن الصرف — ${esc(d.deptName||'')}</h3>
${deptField}
<style>#dispatchItemsContainer .dispatch-item{display:block}#dispatchItemsContainer .dispatch-item .fr{flex-wrap:wrap;align-items:center;gap:8px}#dispatchItemsContainer .dispatch-item .fr>.fg{flex:1;min-width:110px}#dispatchItemsContainer .dispatch-item input.dispatch-item-search{font-weight:700;color:var(--text);font-size:14px}#dispatchItemsContainer .dispatch-item .row-avail{font-weight:700;color:var(--gold)}</style>
<div class="workflow-banner"><i class=ji data-i=info></i> نفس شاشة الإنشاء: ابحث عن الصنف من المخزن وعدّل الكمية — <strong>المتاح</strong> يظهر تحت كل صنف.</div>
<label style="margin-top:10px;display:block">الأصناف <span class="badge bdg-blue" id="dispCount">${(d.items||[]).length}</span></label>
<div id="dispatchItemsContainer"></div>
<button type="button" class="btn btn-blue btn-sm" data-karim-action="addDispatchItemField"><i class=ji data-i=plus></i> إضافة صنف من المخزن</button>
<div class="callout-gold u-my16"><div class="fw-bold"><i class=ji data-i=clipboard-list></i> ملخص الطلب بعد التعديل</div><div class="callout-value u-t14" id="dispSummary">—</div></div>
${d.status==='chef_approved'?`<div class="workflow-banner" style="border-right:4px solid var(--red)">⚠ هذا الطلب معتمد من الشيف — الحفظ <b>يلغي الاعتماد</b> ويرجعه للمراجعة على الأرقام الجديدة</div>`:''}
<div class="fg" style="margin-top:10px"><label>سبب التعديل (يُوثَّق في سجل الطلب)</label><input type="text" id="deReason" placeholder="مثال: تعديل كميات بعد الجرد"></div>
<div class="modal-footer"><button type="button" class="btn" data-karim-action="closeModal">إلغاء</button><button type="button" class="btn btn-gold" data-karim-action="submitDispatchEdit" data-karim-arg0="${esc(String(d.id))}"><i class=ji data-i=save></i> حفظ التعديل</button></div>`);
const container=document.getElementById('dispatchItemsContainer');
(d.items||[]).forEach(it=>{
const wrap=document.createElement('div');
wrap.innerHTML=dispatchEditRowHtml();
const row=wrap.firstElementChild;
container.appendChild(row);
prefillDispatchEditRow(row,it);
});
updateDispSummary();
}

/** تجميع الأصناف من صفوف الشاشة — نفس منطق الإنشاء حرفيًا (تحويل الوحدات الثانوية + الوزن المتغير) */
function collectDispatchItems(){
const items=[];
document.querySelectorAll('.dispatch-item').forEach(row=>{
const name=row.querySelector('.dispatch-item-name')?.value?.trim();
const isCw=row.querySelector('.dispatch-item-catch')?.value==='1';
const pkgUom=row.querySelector('.dispatch-item-pkguom')?.value||'كرتون';
if(isCw){
const boxes=parseInt(row.querySelector('.dispatch-item-pkg')?.value)||0;
const avgBox=parseFloat(row.querySelector('.dispatch-item-avgbox')?.value)||0;
const estKg=avgBox>0?Math.round(boxes*avgBox*1000)/1000:0;
if(name&&boxes>0) {items.push({itemName:name,qty:boxes,unit:pkgUom,packagingQty:boxes,packagingUom:pkgUom,estWeightKg:estKg||null});}
}else{
const qty=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
const uomSel=row.querySelector('.dispatch-item-uom');
const uomOpt=uomSel?.selectedOptions?.[0]||null;
const baseUnit=uomSel?.options?.[0]?.value||row.querySelector('.row-unit')?.textContent?.trim()||'قطعة';
if(name&&qty>0){
if(uomOpt&&Number(uomOpt.dataset.factor||1)!==1){
const factor=Number(uomOpt.dataset.factor);
const baseQty=Math.round(qty*factor*1000)/1000;
items.push({itemName:name,qty:baseQty,unit:baseUnit,requestedQty:qty,requestedUom:uomOpt.value});
}else{
items.push({itemName:name,qty,unit:baseUnit});
}
}
}
});
return items;
}
async function submitDispatchEdit(id){
const items=collectDispatchItems();
if(!items.length){toast('اكتب صنفًا واحدًا على الأقل باسم وكمية صحيحة','error');return;}
const reason=document.getElementById('deReason')?.value.trim()||'';
try{
showLoad();
const res=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/edit`,{method:'PUT',body:JSON.stringify({items,deptCode:(document.getElementById('deDept')?.value)||undefined,reason})});
const i=(STATE.dispatches||[]).findIndex(x=>String(x.id)===String(id));
if(i>-1&&res.dispatch){STATE.dispatches[i]=res.dispatch;}
closeModal();renderPage();
toast(res.chefApprovalReset?'تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة':'تم تعديل الإذن بنجاح','success');
}catch(e){ toast(e.message||'فشل تعديل الإذن','error'); }
finally{ hideLoad(); }
}

function prStatusLabel(s){ return ({pending:'بانتظار الشيف',chef_approved:'اعتمدها الشيف — بانتظار المدير العام',approved:'معتمدة نهائيًا — مغلق',partially_fulfilled:'مستلم جزئيًا (قديم)',fulfilled:'مستلم ومغلق (قديم)',rejected:'مرفوضة',cancelled:'ملغاة'})[s]||s||'—'; }
function prStatusClass(s){ return (s==='approved'||s==='partially_fulfilled')?'bdg-green':s==='fulfilled'?'bdg-teal':s==='chef_approved'?'bdg-blue':s==='pending'?'bdg-orange':s==='rejected'?'bdg-red':'bdg-purple'; }
async function refreshPurchaseRequests(){
try{ STATE.purchaseRequests=await apiFetch('/warehouse/purchase-requests'); STATE._prLoaded=true; }
catch(e){ console.warn('[pr] refresh failed:', e.message); }
if(['warehouse','dispatch','kitchen','wh-prs'].includes(STATE.page)) {renderPage();}
}
function renderPRSection(){
if(!prCanSee()) {return '';}
const rows=(STATE.purchaseRequests||[]).slice().reverse();
const pendChef=rows.filter(r=>r.status==='pending').length;
const pendGM=rows.filter(r=>r.status==='chef_approved').length;
return `<div class="tbl-wrap" style="margin-top:18px"><div class="tbl-hd"><div><h3><i class=ji data-i=shopping-cart></i> طلبات شراء النواقص</h3><small class="text-muted">المخزن ينشئ ← الشيف يوقّع ← المدير العام يعتمد نهائيًا (مغلق — البضاعة تدخل بفواتير المشتريات). طلبات المطبخ الموقّعة من الشيف: <b>نهائية وتدخل المخزن مباشرة</b>.</small></div><div class="u-row-wrap">${prCanCreate()?`<button class="btn btn-gold btn-sm" data-karim-action="openPRCreateModal"><i class=ji data-i=plus></i> طلب شراء جديد</button>`:''}<button class="btn btn-blue btn-sm" data-karim-action="refreshPurchaseRequests"><i class=ji data-i=refresh></i> تحديث</button><span class="badge bdg-orange">بانتظار الشيف: ${fN(pendChef)}</span><span class="badge bdg-blue">بانتظار المدير: ${fN(pendGM)}</span></div></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>الرقم</th><th>الأصناف</th><th>الحالة</th><th>المنشئ</th><th>توقيع الشيف</th><th>اعتماد المدير</th><th>استلام المخزن</th><th>إجراءات</th></tr></thead><tbody>${rows.map((r,idx)=>{const items=Array.isArray(r.items)?r.items:[];return `<tr><td>${idx+1}</td><td class="fw-bold">${esc(r.request_number||('#'+r.id))}</td><td>${items.map(i=>`${esc(i.itemName||i.name||'—')} (${fN(i.requestedQty??i.qty)})`).join('، ')||'—'}</td><td><span class="badge ${prStatusClass(r.status)}">${prStatusLabel(r.status)}</span></td><td>${esc(r.creator_name||'—')}</td><td>${r.chef_approved_name?`<span class="badge bdg-blue">${esc(r.chef_approved_name)}</span>`:'—'}</td><td>${r.gm_approved_name?`<span class="badge bdg-green">${esc(r.gm_approved_name)}</span>`:'—'}</td><td>${r.wh_received_name?`<span class="badge bdg-teal">${esc(r.wh_received_name)}</span>`:'—'}</td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" data-karim-action="viewPRDetails" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=eye></i> عرض</button>${r.status==='pending'&&prCanChef()?`<button class="btn btn-green btn-sm" data-karim-action="openPRChefApproveModal" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=chef-hat></i> توقيع الشيف</button><button class="btn btn-red btn-sm" data-karim-action="openPRChefRejectModal" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=circle-x></i> رفض</button>`:''}${r.status==='chef_approved'&&prCanGM()?`<button class="btn btn-gold btn-sm" data-karim-action="openPRGMApproveModal" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=circle-check></i> اعتماد المدير العام</button><button class="btn btn-red btn-sm" data-karim-action="openPRGMRejectModal" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=circle-x></i> رفض</button>`:''}${r.status==='pending'&&prCanCreate()||r.status==='chef_approved'&&prCanCancel()?`<button class="btn btn-red btn-sm" data-karim-action="cancelPR" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=x-circle></i> إلغاء</button>`:''}${prCanDelete()&&!['approved','fulfilled'].includes(r.status)?`<button class="btn btn-red btn-sm" data-karim-action="deletePR" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=trash></i> حذف نهائي</button>`:''}${['approved','chef_approved','pending','fulfilled'].includes(r.status)?`<button class="btn btn-sm" data-karim-action="printPR" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="9" class="u-empty-sm">لا توجد طلبات شراء بعد — أنشئ طلبًا من نواقص المخزن</td></tr>'}</tbody></table></div></div>`;
}
async function openPRCreateModal(){
if(!prCanCreate()){ toast('إنشاء طلبات الشراء للمطبخ (الشيف) والمخزن والإدارة فقط','error'); return; }
try{
showLoad();
const shortages=await apiFetch('/warehouse/purchase-requests/shortages');
const invNames=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">`).join('');
const rowsHtml=(shortages||[]).map((s,idx)=>`<tr><td><input type="checkbox" class="pr-sel" data-idx="${idx}" checked></td><td class="fw-bold">${esc(s.itemName)}</td><td>${esc(s.unit||'')}</td><td class="c-red">${fN(s.currentQty)}</td><td>${fN(s.minQty)}</td><td><input type="number" class="pr-qty" data-idx="${idx}" data-item-id="${s.itemId}" data-name="${esc(s.itemName)}" data-unit="${esc(s.unit||'وحدة')}" min="0" step="0.001" value="${Number(s.suggestedQty||0)}" style="max-width:110px"></td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى) — أضف يدويًا بالأسفل</td></tr>';
showModal(`<h3><i class=ji data-i=shopping-cart></i> طلب شراء نواقص جديد</h3><div class="workflow-banner">${prIsChefCreator()?'توقيعك على الطلب يجعله <strong>نهائيًا</strong> ويوصله <strong>للمخزن مباشرة</strong> — أمين المخزن يطبعه وينفذه فورًا (بدون مرحلة المدير العام).':'علّم على أصناف النواقص وعدّل الكمية المطلوبة، أو أضف أصنافًا يدويًا (خضار وغيرها) — بعد الإنشاء يوقّع <strong>الشيف</strong> ثم يعتمد <strong>المدير العام</strong> نهائيًا (مغلق — البضاعة تدخل بفواتير المشتريات).'}</div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> نواقص المخزن (${fN((shortages||[]).length)})</h3></div><div class="tbl-scroll" style="max-height:300px;overflow:auto"><table><thead><tr><th><input type="checkbox" checked data-karim-action="kdAct" data-karim-event="change"></th><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>الحد الأدنى</th><th>المطلوب شراؤه</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div><div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=plus></i> إضافة يدوية</h3><button type="button" class="btn btn-blue btn-sm" data-karim-action="prAddManualRow"><i class=ji data-i=plus></i> صف جديد</button></div><div id="prManualRows"></div><datalist id="prInvNames">${invNames}</datalist></div><div class="fg"><label>القسم الطالب (تُحسب عليه التكلفة عند التسليم المباشر)</label><select id="prDept">${(STATE.departments||[]).filter(d=>!String(d.code||'').startsWith('ys_') && d.code !== 'kitchen' && d.code !== 'external_sales' && d.parent_code !== 'kitchen').map((d,i)=>`<option value="${esc(d.code)}" ${i===0?'selected':''}>${esc(d.name||d.code)}</option>`).join('')}</select></div><div class="fg u-mt12"><label>ملاحظات الطلب (اختياري)</label><textarea id="prNotes" rows="2" placeholder="مثال: أولوية للسلطات قبل نهاية الأسبوع"></textarea></div>${prIsChefCreator()?signaturePadMarkup('prCreateSignature','توقيع الشيف على الطلب — '+esc(accountSignatureName())):''}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="confirmPRCreate"><i class=ji data-i=shopping-cart></i> ${prIsChefCreator()?'توقيع وإرسال للمخزن':'إنشاء الطلب'}</button></div>`);
if(prIsChefCreator()){afterModalSignatureInit('prCreateSignature');}
}catch(e){ toast(e.message||'تعذر جلب النواقص','error'); }
finally{ hideLoad(); }
}
function prAddManualRow(){
const box=document.getElementById('prManualRows'); if(!box) {return;}
const div=document.createElement('div'); div.className='fr u-mt8 pr-manual';
div.innerHTML=`<div class="fg" style="flex:2"><label>الصنف</label><input type="text" class="pr-m-name" list="prInvNames" placeholder="اسم الصنف"></div><div class="fg"><label>الوحدة</label><input type="text" class="pr-m-unit" value="وحدة" style="max-width:90px"></div><div class="fg"><label>الكمية المطلوبة</label><input type="number" class="pr-m-qty" min="0" step="0.001" value="0" style="max-width:110px"></div><button type="button" class="btn btn-red btn-sm" data-karim-action="this.parentElement.remove" title="حذف الصف"><i class=ji data-i=trash></i></button>`;
box.appendChild(div);
}
async function confirmPRCreate(){
const items=[];
document.querySelectorAll('.pr-sel:checked').forEach(cb=>{
const input=document.querySelector(`.pr-qty[data-idx="${cb.dataset.idx}"]`); if(!input) {return;}
const qty=Number(input.value);
if(Number.isFinite(qty)&&qty>0) {items.push({itemId:Number(input.dataset.itemId)||null,itemName:input.dataset.name,unit:input.dataset.unit||'وحدة',requestedQty:qty});}
});
document.querySelectorAll('.pr-manual').forEach(row=>{
const name=row.querySelector('.pr-m-name')?.value.trim();
const qty=Number(row.querySelector('.pr-m-qty')?.value);
const unit=row.querySelector('.pr-m-unit')?.value.trim()||'وحدة';
if(name&&Number.isFinite(qty)&&qty>0) {items.push({itemName:name,unit,requestedQty:qty});}
});
if(!items.length){ toast('اختر صنفًا واحدًا على الأقل بكمية موجبة','error'); return; }
const isChef=prIsChefCreator();
let signatureData=null, signerName=null;
if(isChef){
signatureData=readSignaturePad('prCreateSignature'); if(!signatureData) {return;}
signerName=readSignerName('prCreateSignature'); if(!signerName) {return;}
}
try{
showLoad();
const saved=await apiFetch('/warehouse/purchase-requests',{method:'POST',body:JSON.stringify({items,notes:document.getElementById('prNotes')?.value.trim()||'',deptCode:document.getElementById('prDept')?.value||'',signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage();
toast(isChef?`أُنشئ طلب الشراء ${saved.request_number} موقّعًا منك — نهائي ولدى المخزن مباشرة`:`أُنشئ طلب الشراء ${saved.request_number} — بانتظار توقيع الشيف`,'success');
addNotification('طلب شراء نواقص',isChef?`${saved.request_number} موقّع من الشيف — نهائي لدى المخزن`:`${saved.request_number} بانتظار توقيع الشيف`,'info');
}catch(e){ toast(e.message||'تعذر إنشاء طلب الشراء','error'); }
finally{ hideLoad(); }
}
function openPRChefApproveModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const itemsHtml=(Array.isArray(r.items)?r.items:[]).map(i=>`<div style="background:var(--bg3);padding:10px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(i.itemName||i.name)}</strong><span class="badge bdg-blue">${fN(i.requestedQty??i.qty)} ${esc(i.unit||'')}</span></div>${i.currentQty!=null?`<small class="text-muted">الرصيد: ${fN(i.currentQty)} — الحد الأدنى: ${fN(i.minQty??'—')}</small>`:''}</div>`).join('');
showModal(`<h3><i class=ji data-i=chef-hat></i> توقيع الشيف — ${esc(r.request_number||('#'+r.id))}</h3><div class="workflow-banner">توقيعك يحيل الطلب إلى <strong>المدير العام</strong> للاعتماد النهائي — لا يحرك أي مخزون.</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات الشيف (اختياري)</label><textarea id="prChefNotes" rows="2"></textarea></div>${signaturePadMarkup('prChefSignature','توقيع الشيف العمومي — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="confirmPRChefApprove" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-check></i> توقيع وإحالة للمدير العام</button></div>`);
afterModalSignatureInit('prChefSignature');
}
async function confirmPRChefApprove(id){
const signatureData=readSignaturePad('prChefSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prChefSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/chef-approve`,{method:'POST',body:JSON.stringify({notes:document.getElementById('prChefNotes')?.value.trim()||'',signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage();
toast('وقّع الشيف — الطلب الآن بانتظار المدير العام','success');
}catch(e){ toast(e.message||'تعذر توقيع الشيف','error'); }
finally{ hideLoad(); }
}
function openPRChefRejectModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض الشيف — ${esc(r.request_number||('#'+r.id))}</h3><div class="fg"><label>سبب الرفض</label><textarea id="prChefRejReason" rows="3" placeholder="مثال: الكمية مبالغ فيها / الصنف متوفر ببديل"></textarea></div>${signaturePadMarkup('prChefRejSignature','توقيع الشيف على الرفض — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" data-karim-action="confirmPRChefReject" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
afterModalSignatureInit('prChefRejSignature');
}
async function confirmPRChefReject(id){
const reason=document.getElementById('prChefRejReason')?.value.trim();
if(!reason||reason.length<3){ toast('سبب الرفض مطلوب (3 أحرف على الأقل)','error'); return; }
const signatureData=readSignaturePad('prChefRejSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prChefRejSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/chef-reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage(); toast('رفض الشيف الطلب','warning');
}catch(e){ toast(e.message||'تعذر رفض الطلب','error'); }
finally{ hideLoad(); }
}
function openPRGMApproveModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const itemsHtml=(Array.isArray(r.items)?r.items:[]).map(i=>`<div style="background:var(--bg3);padding:10px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(i.itemName||i.name)}</strong><span class="badge bdg-blue">${fN(i.requestedQty??i.qty)} ${esc(i.unit||'')}</span></div></div>`).join('');
showModal(`<h3><i class=ji data-i=crown></i> اعتماد المدير العام — ${esc(r.request_number||('#'+r.id))}</h3><div class="workflow-banner">وقّع الشيف <strong>${esc(r.chef_approved_name||'—')}</strong> بتاريخ ${esc(fDT(r.chef_approved_at))} — اعتمادك نهائي ويُغلق الطلب (طلب فقط بلا حركة مخزون).</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات المدير العام (اختياري)</label><textarea id="prGMNotes" rows="2"></textarea></div>${signaturePadMarkup('prGMSignature','توقيع المدير العام — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="confirmPRGMApprove" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-check></i> اعتماد نهائي</button></div>`);
afterModalSignatureInit('prGMSignature');
}
async function confirmPRGMApprove(id){
const signatureData=readSignaturePad('prGMSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prGMSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/gm-approve`,{method:'POST',body:JSON.stringify({notes:document.getElementById('prGMNotes')?.value.trim()||'',signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage();
toast('اعتمد المدير العام الطلب نهائيًا','success');
addNotification('اعتماد طلب شراء',`${saved.request_number} معتمد نهائيًا من المدير العام`,'success');
}catch(e){ toast(e.message||'تعذر اعتماد المدير العام','error'); }
finally{ hideLoad(); }
}
function openPRGMRejectModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض المدير العام — ${esc(r.request_number||('#'+r.id))}</h3><div class="fg"><label>سبب الرفض</label><textarea id="prGMRejReason" rows="3"></textarea></div>${signaturePadMarkup('prGMRejSignature','توقيع المدير العام على الرفض — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" data-karim-action="confirmPRGMReject" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
afterModalSignatureInit('prGMRejSignature');
}
async function confirmPRGMReject(id){
const reason=document.getElementById('prGMRejReason')?.value.trim();
if(!reason||reason.length<3){ toast('سبب الرفض مطلوب (3 أحرف على الأقل)','error'); return; }
const signatureData=readSignaturePad('prGMRejSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prGMRejSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/gm-reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage(); toast('رفض المدير العام الطلب','warning');
}catch(e){ toast(e.message||'تعذر رفض الطلب','error'); }
finally{ hideLoad(); }
}
function openPRReceiveModal(_id){
// متقاعد بأمر المالك (2026-10-01): دورة طلب الشراء تنتهي باعتماد المدير العام —
// البضاعة تدخل المخزون عبر فواتير المشتريات (الاستلام هنا كان ازدواجًا)
toast('دورة طلب الشراء تنتهي باعتماد المدير العام — سجّل البضاعة بفاتورة مشتريات','info');
return;
}
function prDeliverModeSync(_v){ return; }
function prFreshSuggest(){ return; }
async function confirmPRReceive(_id){
toast('الاستلام من طلب الشراء موقوف — سجّل البضاعة بفاتورة مشتريات','error');
return;
}
async function cancelPR(id){
if(!confirm('إلغاء طلب الشراء المعلّق؟')) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/cancel`,{method:'POST',body:JSON.stringify({})});
upsertStateEntity('purchaseRequests',saved); renderPage(); toast('أُلغي طلب الشراء','info');
}catch(e){ toast(e.message||'تعذر إلغاء الطلب','error'); }
finally{ hideLoad(); }
}
function viewPRDetails(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const items=Array.isArray(r.items)?r.items:[];
const chain=`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=user></i> أنشأ <strong>${esc(r.creator_name||'—')}</strong> الطلب بتاريخ ${esc(fDT(r.created_at))}.</div>`
+(r.chef_approved_name?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=chef-hat></i> وقّع الشيف <strong>${esc(r.chef_approved_name)}</strong> بتاريخ ${esc(fDT(r.chef_approved_at))}${r.chef_notes?` — ${esc(r.chef_notes)}`:''}.</div>`:`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=hourglass></i> بانتظار توقيع الشيف.</div>`)
+(r.gm_approved_name?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=crown></i> اعتمد المدير العام <strong>${esc(r.gm_approved_name)}</strong> بتاريخ ${esc(fDT(r.gm_approved_at))} اعتمادًا نهائيًا${r.gm_notes?` — ${esc(r.gm_notes)}`:''}.</div>`:(r.status==='chef_approved'?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=hourglass></i> بانتظار اعتماد المدير العام.</div>`:''))
+(r.wh_received_name?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=inbox></i> استلم المخزن <strong>${esc(r.wh_received_name)}</strong> بتاريخ ${esc(fDT(r.wh_received_at))} — دخلت البضاعة المخزون.</div>`:'')+(r.status==='rejected'?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=circle-x></i> مرفوض بواسطة <strong>${esc(r.rejected_name||'—')}</strong>: ${esc(r.rejection_reason||'—')}</div>`:'');
showModal(`<h3><i class=ji data-i=shopping-cart></i> طلب الشراء ${esc(r.request_number||('#'+r.id))} — <span class="badge ${prStatusClass(r.status)}">${prStatusLabel(r.status)}</span></h3><div class="u-row-wrap" style="margin:8px 0"><span class="badge bdg-blue"><span class="badge bdg-blue">القسم الطالب: ${esc(r.dept_name||r.dept_code||'—')}</span></span>${r.deliver_mode?`<span class="badge ${r.deliver_mode==='direct'?'bdg-gold':'bdg-teal'}">${r.deliver_mode==='direct'?'تسليم مباشر (مصروف فوري)':r.deliver_mode==='mixed'?'تسليم مختلط':'دخول مخزن'}</span>`:''}</div><div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=package></i> الأصناف (${fN(items.length)})</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>المطلوب</th><th>الرصيد وقت الإنشاء</th></tr></thead><tbody>${items.map(i=>`<tr><td class="fw-bold">${esc(i.itemName||i.name)}</td><td>${esc(i.unit||'—')}</td><td class="c-gold fw-bold">${fN(i.requestedQty??i.qty)}</td><td>${i.currentQty!=null?fN(i.currentQty):'—'}</td></tr>`).join('')}</tbody></table></div></div>${r.notes?`<div class="details-item" style="margin-top:10px"><strong>ملاحظات الطلب:</strong><div>${esc(r.notes)}</div></div>`:''}${chain}<div class="modal-footer">${(r.status==='pending'&&prCanCreate()||r.status==='chef_approved'&&prCanCancel())?`<button class="btn btn-red" data-karim-action="closeModal" data-karim-also="cancelPR"><i class=ji data-i=x-circle></i> إلغاء الطلب</button>`:''}${prCanDelete()&&!['approved','fulfilled'].includes(r.status)?`<button class="btn btn-red" data-karim-action="deletePR" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=trash></i> حذف نهائي</button>`:''}<button class="btn btn-blue" data-karim-action="printPR" data-karim-arg0="${esc(String(r.id))}"><i class=ji data-i=printer></i> طباعة</button><button class="btn btn-gold" data-karim-action="closeModal">إغلاق</button></div>`);
}
function printPR(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const items=Array.isArray(r.items)?r.items:[];
const sigBlock=(label,who,at)=>`<div style="text-align:center;min-width:160px"><div style="height:44px"></div><div style="border-top:1px solid #333;padding-top:5px;font-size:12px;color:#444">${label}${who?`<br><b style="color:#222">${esc(who)}</b>${at?`<br><small>${esc(fDT(at))}</small>`:''}`:'<br>........'}</div></div>`;
const w=(window.openInAppReport ? window.openInAppReport('تقرير المطبخ') : window.open('', '_blank')); if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>طلب شراء ${esc(r.request_number||'')}</title><style>body{font-family:'Cairo',sans-serif;padding:40px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:8px;text-align:center}th{background:#f0f0f0}</style></head><body><h1 class="u-ta-c">${esc(STATE.settings.name)}</h1><h2 class="u-ta-c">طلب شراء نواقص — ${esc(r.request_number||('#'+r.id))}</h2><p><strong>الحالة:</strong> ${esc(prStatusLabel(r.status))} | <strong>التاريخ:</strong> ${esc(fD(r.created_at))} | <strong>القسم الطالب:</strong> القسم الطالب: ${esc(r.dept_name||r.dept_code||'—')} | <strong>المنشئ:</strong> ${esc(r.creator_name||'—')}</p><table><thead><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية المطلوبة</th></thead><tbody>${items.map((i,ix)=>`<tr><td>${ix+1}</td><td>${esc(i.itemName||i.name)}</td><td>${esc(i.unit||'')}</td><td>${fN(i.requestedQty??i.qty)}</td></tr>`).join('')}</tbody></table><p><strong>ملاحظات:</strong> ${esc(r.notes||'لا توجد')}</p>${r.rejection_reason?`<p><strong>سبب الرفض:</strong> ${esc(r.rejection_reason)} (${esc(r.rejected_name||'—')})</p>`:''}<div style="margin-top:48px"><div style="display:flex;justify-content:space-between;gap:16px">${sigBlock('توقيع أمين المخزن',r.creator_name,r.created_at)}${sigBlock('توقيع الشيف',r.chef_approved_name,r.chef_approved_at)}${sigBlock('اعتماد المدير العام',r.gm_approved_name,r.gm_approved_at)}${sigBlock('استلام المخزن',r.wh_received_name,r.wh_received_at)}</div></div></body></html>`);
w.document.close();
}
function renderKitchenReturnsSection(){
// رئيس القسم يرى مرتجعات قسمه فقط
const returns = (STATE.kitchenReturns||[]).slice().reverse().filter(r=>isDeptHead()?String(r.deptCode)===String(myDeptCode()):true);
const totalValue = returns.reduce((sum,item)=>sum+(parseFloat(item.totalValue)||0),0);
const canReturn=['admin','manager','warehouse','kitchen','sous_chef','dept_head'].includes(STATE.currentUser?.role);
const canDelete=['admin','manager','warehouse'].includes(STATE.currentUser?.role);
return `
<div class="tbl-wrap" style="margin-top:18px">
<div class="tbl-hd"><h3><i class=ji data-i=undo></i> سجل المرتجعات</h3>${canReturn?`<button class="btn btn-gold btn-sm" data-karim-action="showKitchenReturnModal"><i class=ji data-i=undo></i> إرجاع جديد</button>`:''}</div>
<div class="tbl-scroll">
<table>
<thead><tr><th>#</th><th>القسم</th><th>طلب الصرف</th><th>الأصناف</th><th>السبب</th><th>التاريخ</th><th>القيمة</th>${canDelete?'<th>حذف</th>':''}</tr></thead>
<tbody>
${returns.map((ret,idx)=>`<tr>
<td>${idx+1}</td>
<td class="fw-bold">${esc(ret.deptName||'—')}</td>
<td class="c-gold">#${ret.dispatchId||'—'}</td>
<td>${(ret.items||[]).map(item=>`${esc(item.name||item.itemName)} (${fN(item.qty)})`).join(', ')}</td>
<td>${esc(ret.reason||'—')}</td>
<td>${fD(ret.date)}</td>
<td class="c-blue fw-bold">${fC(ret.totalValue||0)}</td>
${canDelete?`<td><button class="btn btn-red btn-sm" data-karim-action="deleteKitchenReturn" data-karim-arg0="${esc(ret.id)}" title="حذف المرتجع"><i class=ji data-i=trash></i></button></td>`:''}
</tr>`).join('')||'<tr><td colspan="7" class="u-empty-sm">لا توجد مرتجعات</td></tr>'}
</tbody>
<tfoot>
<tr>
<td colspan="6" class="u-num-l"><i class=ji data-i=banknote></i> الإجمالي المعكوس</td>
<td class="c-blue fw-bold">${fC(totalValue)}</td>
${canDelete?'<td></td>':''}
</tr>
</tfoot>
</table>
</div>
</div>
`;
}
async function deleteKitchenReturn(id){
if(!confirm('تأكيد حذف سجل المرتجع؟ لا يمكن التراجع.')) {return;}
try{
showLoad();
const result=await apiFetch('/warehouse/returns/'+encodeURIComponent(id),{method:'DELETE'});
upsertStateEntity('kitchenReturns',result); // سيزيله من STATE
renderPage();
toast('تم حذف سجل المرتجع','success');
}catch(e){ toast(e.message||'تعذر الحذف','error'); }
finally{ hideLoad(); }
}
function getDispatchDepartments(){
const departments=[...(STATE.departments||[])];
const hasKitchen=departments.some(d=>{const code=String(d.code||'').toLowerCase();const name=String(d.name||d.name_ar||'').toLowerCase();return code==='kitchen'||code==='مطبخ'||name.includes('مطبخ')||name.includes('kitchen');});
if(STATE.page==='kitchen'&&!hasKitchen) {departments.unshift({code:'kitchen',name:'المطبخ',icon:'<i class=ji data-i=cooking-pot></i>',_fallback:true});}
return departments;
}
function showDispatchRequestModal(){
const dispatchDepartments=getDispatchDepartments();
 // رئيس القسم: قسمه فقط وطلب يمر إجباريًا بالشيف العمومي
 // متعدد الأقسام (CAF,SERVICE): قائمة منسدلة بأقسامه فقط — إصلاح جذري 2026-10-10
 // (الحقل المخفي كان يرسل "CAF,SERVICE" خامًا فيُرفض)
const rawCodes=String(myDeptCode()||'').split(',').map(s=>s.trim()).filter(Boolean);
const canonCodes=[...new Set(rawCodes.map(c=>canonicalDeptCode(c)).filter(Boolean))];
const myCodes=canonCodes.length?canonCodes:rawCodes;
const deptField=isDeptHead()
 ? (myCodes.length > 1
  ? `<div class="fg"><label>القسم الطالب</label><select id="dispatchDept">${myCodes.map((c,i)=>`<option value="${esc(c)}" ${i===0?'selected':''}>${esc(deptNameByCode(c)||c)}</option>`).join('')}</select></div><div class="workflow-banner"><i class=ji data-i=chef-hat></i> سيُرسل طلبك إلى <strong>الشيف العمومي</strong> للاعتماد أولًا، ثم إلى <strong>المخازن</strong> للصرف، ويستلمه قسمك من مخزنه الخاص.</div>`
  : `<input type="hidden" id="dispatchDept" value="${esc(myCodes[0]||myDeptCode()||'')}"><div class="fg"><label>القسم الطالب</label><input type="text" value="${esc(deptNameByCode(myCodes[0]||myDeptCode()))}" readonly disabled></div><div class="workflow-banner"><i class=ji data-i=chef-hat></i> سيُرسل طلبك إلى <strong>الشيف العمومي</strong> للاعتماد أولًا، ثم إلى <strong>المخازن</strong> للصرف، ويستلمه قسمك من مخزنه الخاص.</div>`)
 : `<div class="fg"><label>القسم الطالب</label><select id="dispatchDept">${dispatchDepartments.map((d,i)=>`<option value="${d.code}" ${i===0?'selected':''}>${esc(d.name||d.name_ar||d.code)}</option>`).join('')}</select></div>`;
// طلب المالك 2026-10-06: «المتاح» في طلب الصرف = رصيد المخزن الرئيسي فعليًا،
// و«الصنف صفر لا يظهر نهائيًا» — بلا أرصدة رئيسية مؤكدة لا تُعرض أصناف أصلًا
// (لا رجوع للإجمالي الكلي الذي كان يعرض أصنافًا غير متاحة)
showModal(`<h3><i class=ji data-i=package></i> طلب صرف جديد</h3><div class="text-muted u-p8">جارٍ حساب أرصدة المخزن الرئيسي...</div>`);
loadDispatchMainAvailability().then((ok)=>{
if(!ok){
showModal(`<h3><i class=ji data-i=package></i> طلب صرف جديد</h3><div class="workflow-banner" style="color:var(--red,#d64545)"><i class=ji data-i=alert-triangle></i> <strong>تعذر جلب أرصدة المخزن الرئيسي</strong> — لن تُعرض الأصناف حتى يتأكد الرصيد الفعلي (قاعدة: الصنف صفر لا يُعرض أصلًا). لو تكررت: أعد تشغيل خدمة الخادم ثم حدّث الصفحة.</div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button><button class="btn btn-gold" data-karim-action="showDispatchRequestModal"><i class=ji data-i=refresh></i> إعادة المحاولة</button></div>`);
return;
}
showModal(`<h3><i class=ji data-i=package></i> طلب صرف جديد</h3>${deptField}<div class="workflow-banner"><i class=ji data-i=info></i> ابحث عن الصنف وحدد الكمية — <strong>المتاح يظهر برصيد المخزن الرئيسي</strong>، والأصناف صفر الرصيد <strong>لا تظهر نهائيًا</strong>. أصناف <strong>الوزن المتغير</strong> تُطلب <strong>بالكرتون</strong> ويُحدد وزنها عند الصرف.</div><label style="margin-top:10px">الأصناف المطلوبة <span class="badge bdg-blue" id="dispCount">1</span></label><div id="dispatchItemsContainer">${dispRowHtml()}</div><button type="button" class="btn btn-blue btn-sm u-mt8" data-karim-action="addDispatchItemField"><i class=ji data-i=plus></i> إضافة صنف</button><div class="callout-gold u-my16"><div class="fw-bold"><i class=ji data-i=clipboard-list></i> ملخص الطلب</div><div class="callout-value u-t14" id="dispSummary">—</div></div><div class="fg u-mt8"><label>ملاحظات</label><textarea id="dispNotes" rows="2" placeholder="ملاحظة للمخزن (اختياري)"></textarea></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="submitDispatchRequest"><i class=ji data-i=upload></i> إرسال الطلب</button></div>`);
updateDispSummary();
});
}
// خريطة رصيد المخزن الرئيسي لكل صنف — تُجلب لحظة فتح طلب الصرف (أحدث رقم فعلي)
let dispatchMainAvail=null;
async function loadDispatchMainAvailability(){
for(let attempt=0;attempt<2;attempt++){
try{
const res=await apiFetch('/warehouse/main-availability');
dispatchMainAvail=new Map((res.items||[]).map(i=>[Number(i.id),Number(i.on_hand)]));
return true;
}catch(e){ if(String(e&&e.message)==='UNAUTHORIZED'){ break; } if(attempt===0){ await new Promise(r=>setTimeout(r,800)); } }
}
dispatchMainAvail=null;
return false;
}
function mainAvailFor(item){
// بلا بيانات مؤكدة → صفر (قاعدة المالك: الصنف غير المؤكد لا يُعرض متاحًا أبدًا)
if(dispatchMainAvail){ return dispatchMainAvail.get(Number(item.id)) ?? 0; }
return 0;
}
// صف صنف ببحث فوري (اسم/باركود) بدل القائمة المنسدلة — يعمل مع آلاف الأصناف
function dispRowHtml(){
return `<div class="dispatch-item" style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:10px;border:1px solid var(--border)">
<div style="position:relative;margin-bottom:8px">
<input type="text" class="dispatch-item-search u-input-f2" placeholder="ابحث: اسم الصنف أو الباركود..." autocomplete="off" data-karim-action="dispFilterItems" data-karim-event="input" data-karim-pass="element" style="width:100%;font-size:15px;padding:10px 12px">
<input type="hidden" class="dispatch-item-name" value="">
<input type="hidden" class="dispatch-item-max" value="">
<input type="hidden" class="dispatch-item-catch" value="">
<input type="hidden" class="dispatch-item-pkguom" value="">
<input type="hidden" class="dispatch-item-avgbox" value="">
<div class="dispatch-item-list" style="display:none;position:absolute;top:100%;right:0;left:0;z-index:50;background:var(--bg2);border:1px solid var(--border);border-radius:8px;max-height:240px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.35)"></div>
</div>
<div class="fr" style="align-items:flex-end">
<div class="fg" style="flex:1;min-width:120px"><label>الكمية</label><input type="number" class="dispatch-item-qty u-input-f1" placeholder="الكمية" min="0.001" step="0.001" style="font-size:16px;font-weight:700" data-karim-action="updateDispSummary" data-karim-event="input"></div>
<div class="fg dispatch-item-uomwrap" style="flex:1;min-width:120px;display:none"><label>وحدة الطلب</label><select class="dispatch-item-uom" data-karim-action="dispUomChanged" data-karim-event="change" data-karim-pass="element" style="font-size:15px"></select></div>
<div class="fg pkg-wrap" style="flex:1;min-width:120px;display:none"><label>عدد الكراتين *</label><input type="number" class="dispatch-item-pkg u-input-f1" placeholder="عدد الكراتين" min="1" step="1" style="font-size:16px;font-weight:700" data-karim-action="updateDispSummary" data-karim-event="input"></div>
<div style="display:flex;flex-direction:column;gap:2px;min-width:86px"><span class="row-unit badge bdg-green">قطعة</span><small class="row-eq text-muted" style="font-size:11px"></small><small class="row-avail text-muted"></small><small class="row-cwest text-muted" style="display:none"></small></div>
<button type="button" class="btn btn-sm btn-red" data-karim-action="removeDispatchItem" data-karim-pass="element" title="حذف الصنف"><i class=ji data-i=x></i></button>
</div>
</div>`;
}
function updateDispSummary(){
const rows=[...document.querySelectorAll('.dispatch-item')];
const countEl=document.getElementById('dispCount');
if(countEl) {countEl.textContent=rows.length;}
const parts=[];
rows.forEach(row=>{
const name=row.querySelector('.dispatch-item-name')?.value?.trim()||'صنف جديد';
const isCw=row.querySelector('.dispatch-item-catch')?.value==='1';
if(isCw){
const boxes=parseInt(row.querySelector('.dispatch-item-pkg')?.value)||0;
const uom=row.querySelector('.dispatch-item-pkguom')?.value||'كرتون';
const avgBox=parseFloat(row.querySelector('.dispatch-item-avgbox')?.value)||0;
if(boxes>0) {parts.push(avgBox>0?`${name}: ${fN(boxes)} ${uom} (تقديري ~${fN(Math.round(boxes*avgBox*1000)/1000)} كجم)`:`${name}: ${fN(boxes)} ${uom}`);}
}else{
const qty=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
const uomSel=row.querySelector('.dispatch-item-uom');
const uomOpt=uomSel?.selectedOptions?.[0]||null;
const eqEl=row.querySelector('.row-eq');
if(qty>0&&uomOpt&&Number(uomOpt.dataset.factor||1)!==1){
const factor=Number(uomOpt.dataset.factor);
const base=qty*factor;
const baseUnit=uomSel.options[0]?.value||'';
if(eqEl){eqEl.textContent=`≈ ${fN(Math.round(base*1000)/1000)} ${baseUnit}`;}
parts.push(`${name}: ${fN(qty)} ${uomOpt.value} (${fN(Math.round(base*1000)/1000)} ${baseUnit})`);
}else{
if(eqEl){eqEl.textContent='';}
const unit=row.querySelector('.row-unit')?.textContent?.trim()||'';
if(qty>0) {parts.push(`${name}: ${fN(qty)} ${unit}`);}
}
}
});
const s=document.getElementById('dispSummary');
if(s) {s.innerHTML=parts.length?parts.map(esc).join(' • '):'—';}
}
function dispFilterItems(input){
const row=input?.closest('.dispatch-item'); if(!row) {return;}
const list=row.querySelector('.dispatch-item-list'); if(!list) {return;}
const q=String(input.value||'').trim().toLowerCase();
const withAvail=(STATE.inventory||[]).filter(i=>mainAvailFor(i)>0);
const hit=(i)=>String(i.name||'').toLowerCase().includes(q)||(i.barcode&&String(i.barcode).includes(q));
const hitFuzzy=(i)=>(window.arSearchIncludes?window.arSearchIncludes(i.name,q):false)||(i.barcode&&String(i.barcode).includes(q));
// ذكاء البحث (طلب المالك 2026-10-06): «بازنجان» تجد «باذنجان» — الحرفي أولًا ثم المطبعي
let matches;
if(!q){ matches=withAvail; } else { matches=withAvail.filter(hit); if(!matches.length){ matches=withAvail.filter(hitFuzzy); } }
matches=matches.slice(0,30);
// طلب المالك 2026-10-06: أصناف صفر الرصيد لا تظهر في طلب الصرف نهائيًا — لا قائمة ولا عدّاد
list.innerHTML=matches.map(i=>{const avail=mainAvailFor(i);const cw=i.catch_weight_enabled?1:0;const sec=Array.isArray(i.secondary_units)?i.secondary_units.filter(u=>u&&u.uom&&Number(u.factor)>0):[];return `<div data-karim-action="dispPickItem" data-karim-event="mousedown" data-karim-pass="element" data-name="${esc(i.name)}" data-unit="${esc(i.unit||'قطعة')}" data-max="${avail}" data-catch="${cw}" data-pkguom="${esc(i.packaging_uom||'كرتون')}" data-avgbox="${i.packaging_qty_per_base||''}" data-secunits="${esc(JSON.stringify(sec))}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border)"><b>${esc(i.name)}</b>${cw?' <span class="badge bdg-blue">وزن متغير</span>':''}${sec.length?` <span class="badge bdg-purple" title="وحدات طلب: ${esc(sec.map(u=>u.uom).join('، '))}">وحدات: ${esc(sec.map(u=>u.uom).join('، '))}</span>`:''}${i.barcode?` <small class="text-muted">${esc(i.barcode)}</small>`:''}<div class="text-muted" style="font-size:11px">متاح بالرئيسي: ${fN(avail)} ${esc(i.unit||'')}</div></div>`;}).join('')+(matches.length?'':`<div class="text-muted" style="padding:8px">لا نتائج${q?' — الأصناف صفر الرصيد لا تُعرض في طلب الصرف':''}</div>`);
list.style.display='';
}
function dispHideList(input){ const l=input?.closest('.dispatch-item')?.querySelector('.dispatch-item-list'); if(l) {l.style.display='none';} }
function dispPickItem(el){
const row=el?.closest('.dispatch-item'); if(!row) {return;}
const isCw=el.dataset.catch==='1';
const avgBox=parseFloat(el.dataset.avgbox)||0;
row.querySelector('.dispatch-item-name').value=el.dataset.name||'';
row.querySelector('.dispatch-item-search').value=el.dataset.name||'';
const maxEl=row.querySelector('.dispatch-item-max'); if(maxEl){maxEl.value=el.dataset.max||'0';}
row.querySelector('.dispatch-item-catch').value=isCw?'1':'';
row.querySelector('.dispatch-item-pkguom').value=el.dataset.pkguom||'كرتون';
const avgBoxEl=row.querySelector('.dispatch-item-avgbox'); if(avgBoxEl) {avgBoxEl.value=avgBox>0?String(avgBox):'';}
const qtyInput=row.querySelector('.dispatch-item-qty');
const pkgInput=row.querySelector('.dispatch-item-pkg');
const pkgWrap=row.querySelector('.pkg-wrap');
const cwNote=row.querySelector('.row-cwest');
if(isCw){
row.querySelector('.row-unit').textContent=el.dataset.pkguom||'كرتون';
if(qtyInput){qtyInput.placeholder='ملاحظة للمخزن (اختياري)';qtyInput.min='0';qtyInput.style.display='none';}
if(pkgWrap){pkgWrap.style.display='';}
if(cwNote){cwNote.style.display='';cwNote.textContent=avgBox>0?`الوزن يُحدد على الميزان عند الصرف — التقديري: ~${fN(avgBox)} كجم/${el.dataset.pkguom||'كرتون'}`:'الوزن يُحدد على الميزان عند الصرف';}
}else{
row.querySelector('.row-unit').textContent=el.dataset.unit||'قطعة';
if(qtyInput){qtyInput.placeholder='الكمية';qtyInput.min='0.001';}
if(pkgWrap){pkgWrap.style.display='none';}
if(pkgInput){pkgInput.value='';}
if(cwNote){cwNote.style.display='none';cwNote.textContent='';}
}
// وحدات الطلب الثانوية: قائمة اختيار (الأساسية + المسجلة للصنف)
const uomWrap=row.querySelector('.dispatch-item-uomwrap');
const uomSel=row.querySelector('.dispatch-item-uom');
const eqEl=row.querySelector('.row-eq');
let sec=[];
try{ sec=JSON.parse(el.dataset.secunits||'[]').filter(u=>u&&u.uom&&Number(u.factor)>0); }catch(_){}
if(uomSel&&uomWrap){
if(!isCw&&sec.length){
const baseUnit=el.dataset.unit||'قطعة';
uomSel.innerHTML=`<option value="${esc(baseUnit)}" data-factor="1">${esc(baseUnit)} (وحدة المخزن)</option>`+sec.map(u=>`<option value="${esc(u.uom)}" data-factor="${Number(u.factor)}">${esc(u.uom)} = ${fN(u.factor)} ${esc(baseUnit)}</option>`).join('');
uomSel.selectedIndex=0;
uomWrap.style.display='';
}else{
uomSel.innerHTML='';
uomWrap.style.display='none';
}
}
if(eqEl){eqEl.textContent='';}
const av=row.querySelector('.row-avail'); if(av) {av.textContent=`متاح: ${fN(el.dataset.max||0)}`;}
el.parentElement.style.display='none';
updateDispSummary();
}
// تغيير وحدة الطلب — يعيد حساب المكافئ بوحدة المخزن فورًا
function dispUomChanged(select){
const row=select?.closest('.dispatch-item');
if(row){ updateDispSummary(); }
}
function addDispatchItemField(){
const container=document.getElementById('dispatchItemsContainer');
if(!container){return;}
const div=document.createElement('div');
div.innerHTML=dispRowHtml();
container.appendChild(div.firstElementChild);
updateDispSummary();
}
function syncDispatchRowUnit(select){ const row=select?.closest('.dispatch-item'); const unit=select?.options?.[select.selectedIndex]?.dataset?.unit||'قطعة'; if(row) {row.querySelector('.row-unit').textContent=unit;} }
function removeDispatchItem(btn){ const row=btn?.closest('.dispatch-item'); if(!row){return;} const container=row.parentElement; if(container.querySelectorAll('.dispatch-item').length<=1){ row.querySelector('.dispatch-item-qty').value=''; const p=row.querySelector('.dispatch-item-pkg'); if(p){p.value='';} updateDispSummary(); return; } row.remove(); updateDispSummary(); }
let _submittingDispatch = false;
async function submitDispatchRequest(){
if(_submittingDispatch){ toast('جارٍ إرسال الطلب... انتظر','info'); return; }
const deptCode=document.getElementById('dispatchDept')?.value;
if(!deptCode){ toast('حدد القسم الطالب','error'); return; }
const dept=getDispatchDepartments().find(d=>d.code===deptCode) || {code:deptCode,name:deptNameByCode(deptCode)};
const items=[];
const notes=document.getElementById('dispNotes')?.value.trim();
// طلب المالك 2026-10-05: لا يُرسل طلب صرف بلا رصيد — التحقق هنا قبل الإرسال والخادم يحسم
for(const row of document.querySelectorAll('.dispatch-item')){
const name=row.querySelector('.dispatch-item-name')?.value?.trim();
const isCw=row.querySelector('.dispatch-item-catch')?.value==='1';
const pkgUom=row.querySelector('.dispatch-item-pkguom')?.value||'كرتون';
const max=parseFloat(row.querySelector('.dispatch-item-max')?.value)||0;
if(isCw){
const boxes=parseInt(row.querySelector('.dispatch-item-pkg')?.value)||0;
const avgBox=parseFloat(row.querySelector('.dispatch-item-avgbox')?.value)||0;
const estKg=avgBox>0?Math.round(boxes*avgBox*1000)/1000:0;
if(name&&boxes>0){
if(!(max>0)){ toast(`لا يوجد أي رصيد من "${name}" في المخزن — لا يُقبل في طلب صرف`,'error'); return; }
items.push({itemName:name,qty:boxes,unit:pkgUom,packagingQty:boxes,packagingUom:pkgUom,estWeightKg:estKg||null});
}
}else{
const qty=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
const uomSel=row.querySelector('.dispatch-item-uom');
const uomOpt=uomSel?.selectedOptions?.[0]||null;
const baseUnit=uomSel?.options?.[0]?.value||row.querySelector('.row-unit')?.textContent?.trim()||'قطعة';
if(name&&qty>0){
let baseQty=qty;
if(uomOpt&&Number(uomOpt.dataset.factor||1)!==1){
// طلب بوحدة ثانوية (شكارة/كرتون...) → يُحوَّل فورًا لوحدة المخزن الأساسية
baseQty=Math.round(qty*Number(uomOpt.dataset.factor)*1000)/1000;
}
if(baseQty>max+1e-6){ toast(`الرصيد غير كافٍ من "${name}": المتاح ${fN(max)} فقط ولا يمكن طلب ${fN(baseQty)}`,'error'); return; }
if(uomOpt&&Number(uomOpt.dataset.factor||1)!==1){
items.push({itemName:name,qty:baseQty,unit:baseUnit,requestedQty:qty,requestedUom:uomOpt.value});
}else{
items.push({itemName:name,qty,unit:baseUnit});
}
}
}
}
if(items.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
_submittingDispatch = true;
const disp = {id:uid(),deptCode,deptName:dept?.name||'قسم غير معروف',items,status:'pending',date:today(),createdBy:STATE.currentUser?.username||'unknown',notes};
// طلب المالك 2026-10-05: رفض الخادم (رصيد ناقص) يُعرض فورًا — كان يمر رفضًا صامتًا بلا أي رسالة
try{
await persistCreate('dispatches', (saved)=>STATE.dispatches.push(saved), disp);
}catch(e){
_submittingDispatch = false;
const m=String(e.message||'');
if(e.code==='DUPLICATE_DISPATCH'||/مكرر|مشابه|DUPLICATE/.test(m)){ toast('الطلب مسجل بالفعل — لم يتكرر','info'); }
else { toast(m||'تعذر إرسال طلب الصرف — راجع أرصدة المخزن','error'); }
return;
}
_submittingDispatch = false;
closeModal(); renderPage(); buildNav();
toast(isDeptHead()?'تم إرسال طلب الصرف — بانتظار اعتماد الشيف العمومي':'تم إرسال طلب الصرف');
addNotification('طلب صرف جديد',`طلب صرف من ${dept?.name||'قسم'}${isDeptHead()?' — بانتظار اعتماد الشيف العمومي':''}`,'info');
}
// ═══ Task 19: اعتماد/رفض الشيف العمومي ═══
function openChefApproveModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
const warnings=(d.items||[]).map(item=>{const inv=STATE.inventory.find(i=>i.name===item.itemName);const avail=inv?Number(inv.qty):0;const isCw=Boolean(inv?.catch_weight_enabled);const req=Number(item.qty)||0;return {item,avail,req,short:isCw?!(avail>0):avail<req,isCw};});
// طلب المالك 2026-10-05: الاعتماد محجوب نهائيًا لو صنف بلا رصيد — والخادم يحسم كذلك
const stockBlocked=warnings.some(w=>w.short);
const itemsHtml=warnings.map(w=>`<div style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(w.item.itemName)}</strong>${w.isCw?' <span class="badge bdg-blue">وزن متغير</span>':''}<span class="badge ${w.short?'bdg-red':'bdg-green'}">المتاح: ${fN(w.avail)} كجم</span></div><div class="text-muted" style="margin-top:4px">المطلوب: ${fN(w.req)} ${esc(w.item.unit||'')}${w.isCw?` — الوزن الفعلي من الميزان عند الصرف`:''}</div>${w.short?'<div style="color:var(--red);margin-top:4px"><i class=ji data-i=alert-triangle></i> الرصيد غير كافٍ — لا يمكن اعتماد الإذن، عدِّل الكمية أو جهّز المخزون أولًا</div>':''}</div>`).join('');
showModal(`<h3><i class=ji data-i=chef-hat></i> اعتماد الشيف العمومي — ${esc(d.deptName)}</h3><div class="workflow-banner">اعتمادك ينقل الطلب إلى <strong>المخازن</strong> للصرف والخصم — لا يُخصم أي مخزون بهذه الخطوة.</div><div>${itemsHtml}</div>${stockBlocked?`<div class="callout" style="background:rgba(220,53,69,.12);border:1px solid var(--red);color:var(--red);border-radius:var(--r);padding:12px;margin-top:8px"><i class=ji data-i=ban></i> <strong>لا يمكن الاعتماد:</strong> يوجد أصناف بلا رصيد كافٍ في المخزن — لا يُقبل إذن صرف بلا رصيد نهائيًا. عدِّل الكميات أو جهّز المخزون.</div>`:''}<div class="fg u-mt12"><label>ملاحظات الشيف (اختياري)</label><textarea id="chefNotes" rows="2"></textarea></div>${signaturePadMarkup('chefApprovalSignature','توقيع الشيف العمومي')}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" ${stockBlocked?'disabled style="opacity:.5;cursor:not-allowed" title="يوجد أصناف بلا رصيد كافٍ"':''} data-karim-action="confirmChefApprove" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-check></i> اعتماد وإحالة للمخازن</button></div>`);
afterModalSignatureInit('chefApprovalSignature');
}
async function confirmChefApprove(id){
const signatureData=readSignaturePad('chefApprovalSignature'); if(!signatureData){return;}
const signerName=readSignerName('chefApprovalSignature'); if(!signerName){return;}
try{showLoad();
const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-approve`,{method:'POST',body:JSON.stringify({notes:document.getElementById('chefNotes')?.value.trim()||'',signatureData,signerName})});
upsertStateEntity('dispatches',result.dispatch);closeModal();renderPage();buildNav();
toast('تم اعتماد الطلب وإحالته للمخازن','success');
addNotification('اعتماد الشيف',`إذن #${id} صار بانتظار صرف المخازن`,'success');
}catch(e){toast(e.message||'تعذر اعتماد الطلب','error')}finally{hideLoad();}
}
function openChefRejectModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض الشيف العمومي — ${esc(d.deptName)}</h3><div style="background:rgba(231,76,60,0.1);padding:12px;border-radius:var(--r);margin-bottom:16px"><strong>الأصناف:</strong> ${(d.items||[]).map(i=>esc(i.itemName)).join('، ')}</div><div class="fg"><label>سبب الرفض</label><textarea id="chefRejReason" rows="3" placeholder="مثال: الكمية كبيرة على احتياج القسم / الصنف غير مناسب"></textarea></div>${signaturePadMarkup('chefRejectionSignature','توقيع الشيف العمومي على الرفض')}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" data-karim-action="confirmChefReject" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
afterModalSignatureInit('chefRejectionSignature');
}
async function confirmChefReject(id){
const reason=document.getElementById('chefRejReason')?.value.trim();
if(!reason){ toast('أدخل سبب الرفض','error'); return; }
const signatureData=readSignaturePad('chefRejectionSignature'); if(!signatureData){return;}
const signerName=readSignerName('chefRejectionSignature'); if(!signerName){return;}
try{showLoad();
const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
upsertStateEntity('dispatches',result.dispatch);closeModal();renderPage();buildNav();
toast('تم رفض الطلب وسيظهر لرئيس القسم','warning');
addNotification('رفض الشيف',`إذن #${id} مرفوض: ${reason}`,'warning');
}catch(e){toast(e.message||'تعذر رفض الطلب','error')}finally{hideLoad();}
}
const SIGNATURE_PADS = Object.create(null);
const SIGNATURE_DATE_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit'});
// ═══ توقيع صاحب الحساب فقط: الحقل مقفل على اسم الدخول ولا يقبل أي اسم آخر ═══
function accountSignatureName(){ return String(STATE.currentUser?.name||'').trim() || String(STATE.currentUser?.username||'').trim() || ''; }
function normalizeSigName(v){ return String(v||'').trim().replace(/\s+/g,' '); }
function signatureNameMatchesAccount(typed){
const t=normalizeSigName(typed).toLowerCase(); if(!t) {return false;}
const cands=[STATE.currentUser?.name,STATE.currentUser?.username].map(v=>normalizeSigName(v).toLowerCase()).filter(Boolean);
return cands.includes(t);
}
function readSignerName(id){
const state=SIGNATURE_PADS[id];
const v=state?.input?.value ?? document.getElementById(`${id}-input`)?.value ?? '';
return normalizeSigName(v);
}
function signaturePadMarkup(id, title='التوقيع الإلكتروني'){
const locked=accountSignatureName();
return `<div class="signature-panel"><div class="fr"><label><i class=ji data-i=pen-tool></i> ${title}</label></div><input type="text" class="signature-input" id="${id}-input" autocomplete="off" spellcheck="false" maxlength="60" value="${esc(locked)}" readonly tabindex="-1" aria-readonly="true" aria-label="${title} — توقيع ${esc(locked)}"><canvas id="${id}" width="900" height="220" aria-label="${title}"></canvas><small class="text-muted">التوقيع مقفل باسم حسابك (<strong>${esc(locked||'—')}</strong>) — لا يمكن توقيع أي اسم آخر. التوقيع موثّق بتاريخ اليوم.</small></div>`;
}
function signatureFont(size){ return `700 ${size}px 'Aref Ruqaa','Cairo',cursive`; }
function paintTypedSignature(id){
const state=SIGNATURE_PADS[id]; if(!state||!state.ctx) {return;}
const {canvas,ctx,input}=state; const name=(input?.value||'').trim();
ctx.clearRect(0,0,canvas.width,canvas.height);
state.hasInk=name.length>=2;
ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.direction='rtl';
if(!state.hasInk){
ctx.fillStyle='#9aa1ad'; ctx.font="26px 'Cairo',sans-serif";
ctx.fillText('التوقيع يظهر هنا بعد كتابة الاسم', canvas.width/2, canvas.height/2 - 8);
return;
}
let size=68; ctx.font=signatureFont(size);
while(ctx.measureText(name).width > canvas.width-130 && size>30){ size-=4; ctx.font=signatureFont(size); }
const nameW=Math.min(ctx.measureText(name).width, canvas.width-110);
ctx.fillStyle='#1f2430';
ctx.fillText(name, canvas.width/2, 88);
ctx.strokeStyle='#b45309'; ctx.lineWidth=2.5; ctx.lineCap='round';
const uy=148;
ctx.beginPath();
ctx.moveTo(canvas.width/2 - nameW/2, uy);
ctx.bezierCurveTo(canvas.width/2 - nameW/6, uy-12, canvas.width/2 + nameW/6, uy+12, canvas.width/2 + nameW/2, uy-6);
ctx.stroke();
ctx.fillStyle='#6b7280'; ctx.font="20px 'Cairo',sans-serif";
ctx.fillText(`توقيع إلكتروني • ${SIGNATURE_DATE_FMT.format(new Date())}`, canvas.width/2, 188);
}
function initSignaturePad(id){
const canvas=document.getElementById(id); if(!canvas) {return;}
const input=document.getElementById(`${id}-input`);
SIGNATURE_PADS[id]={canvas,ctx:canvas.getContext('2d'),input,hasInk:false};
// قفل الحقل على اسم الحساب — أي محاولة لتغييره عبر الأدوات تُرفض عند القراءة في الخادم أيضًا
if(input){ input.value=accountSignatureName(); input.setAttribute('readonly',''); input.addEventListener('input',()=>{ const want=accountSignatureName(); if(input.value!==want) {input.value=want;} paintTypedSignature(id); }); }
paintTypedSignature(id);
if(document.fonts?.load){
document.fonts.load("700 68px 'Aref Ruqaa'")
.then(()=>document.fonts.ready)
.then(()=>paintTypedSignature(id))
.catch(()=>{});
}
}
function clearSignaturePad(id){
const state=SIGNATURE_PADS[id]; if(!state) {return;}
// لا مسح لاسم آخر — إعادة القفل على اسم الحساب فقط
if(state.input){ state.input.value=accountSignatureName(); }
paintTypedSignature(id);
}
function readSignaturePad(id){
const state=SIGNATURE_PADS[id];
const typed=readSignerName(id);
const locked=accountSignatureName();
if(!normalizeSigName(typed) || !normalizeSigName(locked) || !signatureNameMatchesAccount(typed)){
toast(`التوقيع باسم حسابك فقط (${locked||'—'}) — لا يجوز توقيع أي اسم آخر`,'error');
if(state?.input) {state.input.value=locked;}
paintTypedSignature(id);
return null;
}
if(state?.input && state.input.value!==locked) {state.input.value=locked;}
if(!state?.hasInk){ paintTypedSignature(id); if(!state?.hasInk){ toast('تعذر تجهيز التوقيع — أعد فتح النافذة','error'); return null; } }
paintTypedSignature(id);
return state.canvas.toDataURL('image/png');
}
function afterModalSignatureInit(...ids){setTimeout(()=>ids.forEach(initSignaturePad),0);}
function dispatchStatusLabel(status){return ({pending:`<i class=ji data-i=hourglass></i> ${t('st.pending')}`,chef_approved:`<i class=ji data-i=chef-hat></i> ${t('st.chefOk')}`,approved:`<i class=ji data-i=circle-check></i> ${t('st.approved')}`,partially_received:`<i class=ji data-i=dot-orange></i> ${t('st.partial')}`,received:`<i class=ji data-i=package></i> ${t('st.received')}`,rejected:`<i class=ji data-i=circle-x></i> ${t('st.rejected')}`})[status]||'—';}
function dispatchStatusClass(status){return status==='pending'?'bdg-orange':status==='chef_approved'?'bdg-purple':(['approved','received'].includes(status)?'bdg-green':status==='partially_received'?'bdg-blue':'bdg-red');}
function openApproveModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
let itemsHtml=''; let total=0;
d.items.forEach((item,idx)=>{
const inv=STATE.inventory.find(i=>i.name===item.itemName);
const maxQty=inv?inv.qty:0;
const isCatchWeight = inv?.catch_weight_enabled;
const pkgUom = inv?.packaging_uom||item.packagingUom||'كرتون';
if(!isCatchWeight){
const val=Math.min(item.qty,maxQty)*(inv?.avgCost||0);
total+=val;
itemsHtml+=`<div style="background:var(--bg3);padding:15px;border-radius:var(--r);margin-bottom:10px">
<div class="fr"><div><strong>${esc(item.itemName)}</strong></div>
<div>المتاح: ${fN(maxQty)} | المطلوب: ${fN(item.qty)}${item.requestedUom&&item.requestedQty?` <span class="badge bdg-purple" title="القسم طلب بوحدة ثانوية — تم التحويل لوحدة المخزن">طلب بـ ${fN(item.requestedQty)} ${esc(item.requestedUom)}</span>`:''}</div></div>
<div class="fr">
<div class="fg"><label>الكمية المعتمدة</label><input type="number" id="apQty_${idx}" value="${Math.min(item.qty,maxQty)}" step="0.01" min="0" max="${maxQty}" data-karim-action="updateApproveTotal" data-karim-event="input"></div>
<div class="fg"><label>القيمة</label><div id="apVal_${idx}" class="c-gold fw-bold">${fC(val)}</div></div></div>
${maxQty<item.qty?`<div class="text-muted" style="color:var(--orange)"><i class=ji data-i=alert-triangle></i> الكمية المطلوبة أكبر من المتوفر</div>`:''}</div>`;
return;
}
// Catch Weight: الطلب بالكرتون — أوزن وصرف بالكيلو الفعلي (بلا أي تقدير)
const reqBoxes=Number(item.packagingQty??item.qty)||0;
itemsHtml+=`<div style="background:var(--bg3);padding:15px;border-radius:var(--r);margin-bottom:10px">
<div class="fr"><div><strong>${esc(item.itemName)}</strong> <span class="badge bdg-blue">وزن متغير</span></div>
<div>المطلوب: <b class="c-gold">${fN(reqBoxes)} ${esc(pkgUom)}</b> | المتاح: ${fN(maxQty)} كجم</div></div>
<div class="fr">
<input type="hidden" id="apQty_${idx}" value="0">
<div class="fg"><label>عدد الكراتين المصروفة *</label><input type="number" id="apPkgQty_${idx}" value="${reqBoxes||''}" step="1" min="1" placeholder="عدد الكراتين" data-karim-action="updateApproveTotal" data-karim-event="input"></div>
<div class="fg"><label>الوزن الفعلي بالكيلو (الميزان) *</label><input type="number" id="apWeight_${idx}" step="0.001" min="0.001" max="${maxQty}" placeholder="أوزن الكراتين وأدخل الوزن" data-karim-action="updateApproveTotal" data-karim-event="input"></div>
<div class="fg"><label>القيمة (على الفعلي)</label><div id="apVal_${idx}" class="c-gold fw-bold">${fC(0)}</div></div></div>
<div class="text-muted" id="apEst_${idx}" style="font-size:12px"></div><div class="text-muted" id="apAvg_${idx}" style="font-size:12px"></div></div>`;
});
showModal(`<h3><i class=ji data-i=circle-check></i> الموافقة على طلب صرف - ${esc(d.deptName)}</h3><div class="workflow-banner">اعتماد المخزن يخصم الكمية من المخزون ويسجل تكلفة القسم في نفس المعاملة.</div><div id="approveItems">${itemsHtml}</div><div class="callout-gold u-my16"><div class="fw-bold"><i class=ji data-i=banknote></i> القيمة الإجمالية</div><div class="callout-value" id="approveTotal">${fC(total)}</div></div><div class="fg"><label>ملاحظات</label><textarea id="approveNotes" rows="2"></textarea></div>${signaturePadMarkup('warehouseApprovalSignature','توقيع أمين المخزن المعتمد')}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="confirmApprove" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-check></i> تأكيد الموافقة</button></div>`);
window.updateApproveTotal=function(){
let t=0;
const disp=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!disp){return;}
disp.items.forEach((item,idx)=>{
const inv=STATE.inventory.find(i=>i.name===item.itemName);
const isCatchWeight = inv?.catch_weight_enabled;
if(isCatchWeight){
const weight=parseFloat(document.getElementById(`apWeight_${idx}`)?.value)||0;
const boxes=parseFloat(document.getElementById(`apPkgQty_${idx}`)?.value)||0;
const val=weight*(inv?.avgCost||0);
t+=val;
const valEl=document.getElementById(`apVal_${idx}`);
if(valEl) {valEl.innerHTML=fC(val);}
const avgEl=document.getElementById(`apAvg_${idx}`);
if(avgEl) {avgEl.textContent=(weight>0&&boxes>0)?`متوسط الكرتون المحسوب: ${fN(weight/boxes)} كجم`:'';}
// الوزن التقديري المتوقع (عدد الكراتين × متوسط وزن الكرتون المسجل) + فرق الميزان
const estEl=document.getElementById(`apEst_${idx}`);
const est=boxes*(Number(inv?.packaging_qty_per_base)||0);
if(estEl){
if(est>0&&boxes>0){
const diff=weight>0?Math.round((weight-est)*1000)/1000:null;
const diffPct=diff!=null&&est>0?Math.round(diff/est*1000)/10:null;
estEl.textContent=`الوزن التقديري المتوقع: ~${fN(Math.round(est*1000)/1000)} كجم${diff!=null?` — فرق الميزان: ${diff>=0?'+':''}${fN(diff)} كجم (${diffPct>0?'+':''}${diffPct}%)`:''}`;
}else{estEl.textContent='';}
}
return;
}
const qty=parseFloat(document.getElementById(`apQty_${idx}`)?.value)||0;
const val=qty*(inv?.avgCost||0);
t+=val;
const valEl=document.getElementById(`apVal_${idx}`);
if(valEl) {valEl.innerHTML=fC(val);}
});
const totalEl=document.getElementById('approveTotal');
if(totalEl) {totalEl.innerHTML=fC(t);}
};
afterModalSignatureInit('warehouseApprovalSignature');
}
let _approvingDispatch = false;
async function confirmApprove(id){
// حارس النقر المتكرر (لوج الإنتاج: 88 طلب اعتماد لنفس الإذن في دقيقتين — لا رد فعل
// أثناء التنفيذ فيعيد المستخدم الضغط، وتصطف الطلبات خلف قفل الصف 20 ثانية)
if(_approvingDispatch){ toast('اعتماد الإذن قيد التنفيذ... انتظر النتيجة','info'); return; }
_approvingDispatch = true;
showLoad();
try{
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){toast('تعذر العثور على طلب الصرف — حدّث الصفحة وحاول مجددًا','error');return;}
const approvedItems=[];
let hasError=false;
const approveNotes=document.getElementById('approveNotes')?.value.trim()||'';
const signatureData=readSignaturePad('warehouseApprovalSignature'); if(!signatureData){return;}
const signerName=readSignerName('warehouseApprovalSignature'); if(!signerName){toast('اسم الموقّع مطلوب — يجب أن يطابق اسم حسابك','error');return;}
d.items.forEach((item,idx)=>{
const inv=STATE.inventory.find(i=>i.name===item.itemName);
const isCw=Boolean(inv?.catch_weight_enabled);
if(isCw){
const actualWeight=parseFloat(document.getElementById(`apWeight_${idx}`)?.value)||0;
const packagingQty=parseFloat(document.getElementById(`apPkgQty_${idx}`)?.value)||0;
if(!(actualWeight>0)){ hasError=true; toast(`أدخل الوزن الفعلي بالكيلو للصنف "${item.itemName}"`,'error'); return; }
if(!(packagingQty>0)){ hasError=true; toast(`أدخل عدد الكراتين المصروفة للصنف "${item.itemName}"`,'error'); return; }
if(actualWeight>Number(inv?.qty||0)){ hasError=true; toast(`الوزن الفعلي من "${item.itemName}" أكبر من المتوفر (${fN(inv.qty)} كجم)`,'error'); return; }
const val=actualWeight*(Number(inv?.avgCost)||0);
approvedItems.push({name:item.itemName,itemName:item.itemName,unit:inv?.catch_weight_uom||'kg',requestedQty:actualWeight,requestedPackagingQty:Number(item.packagingQty??item.qty)||null,approvedQty:actualWeight,avgCost:Number(inv?.avgCost)||0,approvedValue:val,
actualWeight,packagingQty,packagingUom:inv?.packaging_uom||'كرتون',catchWeightUom:inv?.catch_weight_uom||'kg'});
return;
}
const approvedQty=parseFloat(document.getElementById(`apQty_${idx}`)?.value);
if(isNaN(approvedQty)||approvedQty<0){ hasError=true; return; }
if(inv&&approvedQty>Number(inv.qty)){ hasError=true; toast(`الكمية المعتمدة من "${item.itemName}" أكبر من المتوفر`,'error'); return; }
if(approvedQty>0){
const val=approvedQty*(Number(inv?.avgCost)||0);
approvedItems.push({name:item.itemName,itemName:item.itemName,unit:item.unit,requestedQty:item.qty,approvedQty,avgCost:Number(inv?.avgCost)||0,approvedValue:val,
actualWeight:null,packagingQty:null,packagingUom:null,catchWeightUom:inv?.catch_weight_uom||'kg'});
}
});
if(hasError||approvedItems.length===0){ toast('تحقق من البيانات','error'); return; }
try{
const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({approvedItems,approveNotes,signatureData,signerName})});
upsertStateEntity('dispatches',result.dispatch);
(result.stockChanges||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
(result.expenses||[]).forEach(row=>upsertStateEntity('expenses',row));
closeModal(); renderPage();
toast(`تمت الموافقة وحُسبت مصاريف القسم بقيمة ${fC(result.totalValue||0)}`,'success');
addNotification('تمت الموافقة',`تم اعتماد طلب الصرف من ${d.deptName} وتسجيل تكلفته على القسم`,'success');
}catch(e){ if(e && e.code==='DISPATCH_APPROVE_IN_PROGRESS'){ toast('الإذن قيد الاعتماد فعلًا — لا تضغط مجددًا','warning'); return; } toast(e.message||'تعذر اعتماد طلب الصرف','error'); }
}catch(err){ console.error('[confirmApprove]',err); toast('خطأ غير متوقع أثناء الاعتماد: '+(err?.message||err),'error'); }
finally{ _approvingDispatch=false; hideLoad(); }
}
function openRejectModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض طلب صرف</h3><div style="background:rgba(231,76,60,0.1);padding:12px;border-radius:var(--r);margin-bottom:16px"><strong>القسم:</strong> ${esc(d.deptName)}<br><strong>الأصناف:</strong> ${d.items.length}</div><div class="fg"><label>سبب الرفض</label><textarea id="rejReason" rows="3"></textarea></div>${signaturePadMarkup('warehouseRejectionSignature','توقيع أمين المخزن على الرفض')}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" data-karim-action="confirmReject" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);afterModalSignatureInit('warehouseRejectionSignature');
}
async function confirmReject(id){
const reason=document.getElementById('rejReason')?.value.trim();
if(!reason){ toast('أدخل سبب الرفض','error'); return; }
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
try{
  const signatureData=readSignaturePad('warehouseRejectionSignature'); if(!signatureData){return;}
  const signerName=readSignerName('warehouseRejectionSignature'); if(!signerName){return;}
  const rejectedBy=STATE.currentUser?.username||'unknown';
  const rejectedDate=new Date().toISOString();
  const response=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
 const saved=response.dispatch;
 upsertStateEntity('dispatches', saved||{...d,status:'rejected',rejectionReason:reason,rejectedBy,rejectedDate});
 closeModal(); renderPage();
 toast('تم رفض الطلب','warning');
}catch(e){ toast(e.message||'تعذر رفض طلب الصرف','error'); }
}
function openReceiveModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id)); if(!d){return;}
const items=d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items||[];
const itemsHtml=items.map((item,idx)=>{const approved=Number(item.approvedQty??item.qty)||0;const isCw=Boolean(item.catchWeightEnabled||item.actualWeight);const apBoxes=Number(item.packagingQty)||0;const pkgUom=item.packagingUom||'كرتون';return `<div style="background:var(--bg3);padding:14px;border-radius:var(--r);margin-bottom:10px"><div class="fr"><strong>${esc(item.itemName||item.name)}</strong>${isCw?' <span class="badge bdg-blue">وزن متغير</span>':''}<span class="badge bdg-blue">المعتمد: ${fN(approved)} ${esc(item.unit||'')}${isCw&&apBoxes>0?` (${fN(apBoxes)} ${esc(pkgUom)})`:''}</span></div><div class="fr"><div class="fg u-mt8"><label>الوزن المستلم فعليًا (كجم)</label><input type="number" id="receivedQty_${idx}" min="0" max="${approved}" step="0.001" value="${approved}"></div>${isCw?`<div class="fg u-mt8"><label>عدد الكراتين المستلمة</label><input type="number" id="receivedPkg_${idx}" min="0" max="${apBoxes||''}" step="1" value="${apBoxes||''}"></div>`:''}</div></div>`;}).join('');
showModal(`<h3><i class=ji data-i=inbox></i> استلام إذن الصرف — ${esc(d.deptName)}</h3><div class="workflow-banner">الاستلام والتوقيع باسم حسابك فقط (<strong>${esc(accountSignatureName()||'—')}</strong>) — لا يمكن توقيع أي اسم آخر. راجع الكميات ثم أكّد. لا يمكن تسجيل الاستلام مرتين.</div><div>${itemsHtml}</div><div class="fg"><label>ملاحظات الاستلام</label><textarea id="receiptNotes" rows="2" placeholder="أي عجز أو تلف أو ملاحظة عند الاستلام"></textarea></div>${signaturePadMarkup('kitchenReceiptSignature','توقيع المستلم — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="confirmReceive" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=inbox></i> تأكيد الاستلام والتوقيع</button></div>`);
afterModalSignatureInit('kitchenReceiptSignature');
}
async function confirmReceive(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id)); if(!d){return;}
const signatureData=readSignaturePad('kitchenReceiptSignature'); if(!signatureData){return;}
const signerName=readSignerName('kitchenReceiptSignature'); if(!signerName){return;}
const items=d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items||[];
const receivedItems=[]; let invalid=false;
items.forEach((item,idx)=>{const approved=Number(item.approvedQty??item.qty)||0;const received=Number(document.getElementById(`receivedQty_${idx}`)?.value);if(!Number.isFinite(received)||received<0||received>approved){invalid=true;}const isCw=Boolean(item.catchWeightEnabled||item.actualWeight);const apBoxes=Number(item.packagingQty)||0;const pkgRaw=document.getElementById(`receivedPkg_${idx}`)?.value;const recvPkg=isCw?(pkgRaw===''||pkgRaw==null?apBoxes:Number(pkgRaw)):null;if(isCw&&(!Number.isFinite(recvPkg)||recvPkg<0||recvPkg>apBoxes)){invalid=true;}receivedItems.push({itemName:item.itemName||item.name,receivedQty:received,...(isCw?{receivedPackagingQty:recvPkg}:{}),notes:''});});
if(invalid){toast('تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة','error');return;}
try{showLoad();const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/receive`,{method:'POST',body:JSON.stringify({items:receivedItems,notes:document.getElementById('receiptNotes')?.value.trim()||'',signatureData,signerName})});upsertStateEntity('dispatches',result.dispatch);closeModal();renderPage();toast('تم تسجيل استلام المطبخ بالتوقيع','success');addNotification('استلام مطبخ',`تم استلام طلب الصرف #${id} وتوثيقه`,'success');}catch(e){toast(e.message||'تعذر تسجيل استلام المطبخ','error')}finally{hideLoad();}
}
function viewDispatchDetails(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
const statusLabel=dispatchStatusLabel(d.status);
const sourceItems=(d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items)||[];
const receiptAudit=d.kitchenReceivedAt?`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=signature></i> تم استلام الإذن وتوقيعه من ${esc(d.deptName)} بواسطة <strong>${esc(d.kitchenReceivedBy||'—')}</strong> بتاريخ ${esc(fDT(d.kitchenReceivedAt))}.<br><small>التوقيع الإلكتروني محفوظ ضمن سجل الإذن.</small></div>`:'<div class="workflow-banner" style="margin-top:14px">الإذن معتمد من المخازن ولم يتم تسجيل استلام القسم وتوقيعه بعد.</div>';
const chefAudit=d.chefApprovedAt?`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=chef-hat></i> اعتمد <strong>الشيف العمومي</strong> الطلب بواسطة <strong>${esc(d.chefApprovedBy||'—')}</strong> بتاريخ ${esc(fDT(d.chefApprovedAt))} وأحاله إلى المخازن.</div>`:(d.needsChefApproval?`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=hourglass></i> الطلب مقدم من <strong>رئيس القسم</strong> — بانتظار اعتماد الشيف العمومي قبل وصوله للمخازن.</div>`:'');
showModal(`<h3><i class=ji data-i=clipboard-list></i> تفاصيل طلب الصرف #${d.id}</h3><div class="fr"><div class="details-item"><strong>القسم:</strong><div>${esc(d.deptName)}</div></div><div class="details-item"><strong>الحالة:</strong><div>${statusLabel}</div></div></div><div class="fr"><div class="details-item"><strong>التاريخ:</strong><div>${fD(d.date)}</div></div><div class="details-item"><strong>الطالب:</strong><div>${esc(d.createdBy||'—')}${d.creatorRole==='dept_head'?' <span class="badge bdg-purple">رئيس قسم</span>':''}</div></div></div><div class="details-list" style="margin-top:10px"><div class="details-item"><strong>المرحلة الحالية:</strong><div>${esc(dispatchChainStage(d))}</div></div></div><div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=package></i> التفاصيل</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>${sourceItems.map(item=>{const cw=item.catchWeightEnabled||item.actualWeight;const q=cw&&item.packagingQty?`${fN(item.approvedQty||item.qty||0)} ${esc(item.catchWeightUom||item.unit||'كجم')} <small class="text-muted">(${fN(item.packagingQty)} ${esc(item.packagingUom||'كرتون')})</small>`:`${fN(item.approvedQty||item.qty||0)}`;return `<tr><td class="fw-bold">${esc(item.itemName||item.name)}${cw?' <span class="badge bdg-blue">وزن متغير</span>':''}</td><td>${esc(item.unit||'—')}</td><td>${q}</td><td class="c-gold">${item.approvedValue?fC(item.approvedValue):'—'}</td></tr>`;}).join('')}</tbody></table></div></div><div class="details-list"><div class="details-item"><strong>ملاحظات الطلب:</strong><div>${esc(d.notes||'—')}</div></div>${d.approveNotes?`<div class="details-item"><strong>ملاحظات الاعتماد:</strong><div>${esc(d.approveNotes)}</div></div>`:''}${d.rejectionReason?`<div class="details-item"><strong>سبب الرفض:</strong><div>${esc(d.rejectionReason)}</div></div>`:''}</div>${chefAudit}${receiptAudit}<div class="modal-footer"><button class="btn btn-gold" data-karim-action="closeModal">إغلاق</button></div>`);
}
async function printDispatchNote(id){
let d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
// PERF 2026-10-08: القائمة بلا صور تواقيع — جلب الصف الكامل للطباعة
try{
const full=await apiFetch(`/dispatches/${encodeURIComponent(id)}`);
if(full&&(full.id||full.data)){ d=full.data||full; }
}catch(_){ /* fallback للصف المحلي */ }
const dept=STATE.departments.find(x=>x.code===d.deptCode);
const printWindow=(window.openInAppReport ? window.openInAppReport('تقرير المطبخ') : window.open('', '_blank'));
if(!printWindow){ toast('اسمح بالنوافذ المنبثقة لطباعة إذن الصرف','warning'); return; }
const sigBlock=(label,dataUrl,who,at)=>`<div style="text-align:center;min-width:170px;flex:1">${dataUrl?`<img src="${dataUrl}" style="height:54px;object-fit:contain;margin-bottom:2px" alt="${label}">`:'<div style="height:54px"></div>'}<div style="border:1px solid #e5e7eb;border-top:3px solid #0f172a;border-radius:0 0 10px 10px;padding:8px 6px;font-size:12px;color:#444;background:#f8fafc"><b style="color:#0f172a">${label}</b>${who?`<br><b style="color:#111">${esc(who)}</b>`:''}${at?`<br><small>${esc(at)}</small>`:''}</div></div>`;
const pItems=(d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items)||[];
const pTotal=pItems.reduce((s,i)=>s+Number(i.approvedValue||0),0);
const pStatusAr={pending:'بانتظار الاعتماد',chef_approved:'معتمد من الشيف — بانتظار المخازن',approved:'معتمد من المخازن',partially_received:'مستلم جزئيًا',received:'مستلم',rejected:'مرفوض'}[d.status]||d.status||'—';
const pRow=(item,idx)=>{const cw=item.catchWeightEnabled||item.actualWeight;const qty=item.approvedQty??item.qty??0;const qtyCell=cw&&item.packagingQty?`${fN(qty)} ${esc(item.catchWeightUom||item.unit||'كجم')}<br><small>(${fN(item.packagingQty)} ${esc(item.packagingUom||'كرتون')})</small>`:`${fN(qty)} ${esc(item.unit||'')}`;const price=Number(item.avgCost)||0;return `<tr><td>${idx+1}</td><td style="text-align:right">${esc(item.name||item.itemName)}${cw?' <small>⚖ وزن متغير</small>':''}</td><td>${qtyCell}</td><td>${price?fC(price):'—'}</td><td class="c-gold fw-bold">${item.approvedValue?fC(item.approvedValue):'—'}</td></tr>`;};
const pChain=[d.createdBy?['الطلب',d.createdBy,d.date||d.requestedAt]:null,d.chefApprovedBy?['اعتماد الشيف',d.chefApprovedBy,d.chefApprovedAt]:null,d.warehouseApprovedBy?['اعتماد المخزن',d.warehouseApprovedBy,d.warehouseApprovedAt||d.approvedDate]:null,d.kitchenReceivedBy?['الاستلام',d.kitchenReceivedBy,d.kitchenReceivedAt]:null].filter(Boolean);
printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن صرف #${d.id}</title><style>*{box-sizing:border-box}body{font-family:'Cairo',Tahoma,Arial,sans-serif;color:#1a1a1a;background:#eef2f7;margin:0;padding:32px 36px;direction:rtl}.sheet{max-width:800px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 8px 28px rgba(15,23,42,.10);padding:22px 24px 20px}.head{display:flex;align-items:center;gap:16px;background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-bottom:4px solid #c9a227;border-radius:12px 12px 0 0;padding:18px 24px;margin:-22px -24px 16px}.doc-logo{width:74px;height:74px;object-fit:contain;background:#fff;border:2px solid #c9a227;border-radius:14px;padding:5px;box-shadow:0 2px 10px rgba(0,0,0,.35)}.head h1{margin:0;color:#f5d76e;font-size:24px}.head p{margin:2px 0;color:#cbd5e1;font-size:13px}.doc-title{text-align:center;margin:14px 0 4px}.doc-title h2{margin:0;font-size:22px;letter-spacing:.5px;color:#0f172a}.doc-title .st{display:inline-block;margin-top:8px;padding:4px 20px;border:0;border-radius:20px;font-size:12px;font-weight:800;color:#f5d76e;background:#0f172a;letter-spacing:.3px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.meta div{border:1px solid #e5e7eb;border-right:4px solid #c9a227;border-radius:10px;padding:8px 12px;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.05)}.meta b{display:block;color:#8a6d1b;font-size:11px;margin-bottom:2px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#0f172a;color:#f5d76e;font-size:12px;letter-spacing:.3px}td small{color:#555}tbody tr:nth-child(even) td{background:#f8fafc}tfoot td{font-weight:800;background:#0f172a;color:#f5d76e;font-size:14px}.chain{display:flex;gap:8px;margin-top:14px}.chain div{flex:1;border:1px solid #e5e7eb;border-top:3px solid #c9a227;border-radius:10px;padding:8px 6px;font-size:11px;text-align:center;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.05)}.chain b{display:block;color:#0f172a;margin-bottom:2px}.notes{margin-top:12px;border:1px solid #e5e7eb;border-right:4px solid #c9a227;border-radius:10px;padding:10px 14px;font-size:13px;min-height:44px;background:#fffbeb}.sigs{display:flex;gap:14px;margin-top:34px}.foot{margin-top:18px;text-align:center;font-size:11px;color:#888;border-top:2px solid #c9a227;padding-top:8px}.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 26px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff;font-weight:700}.controls button.secondary{background:#555}@media print{body{padding:0;background:#fff}.sheet{box-shadow:none;border:0;border-radius:0}.head,.head h1,th,tfoot td,.doc-title .st{print-color-adjust:exact;-webkit-print-color-adjust:exact}.controls{display:none!important}@page{size:A4;margin:11mm}}</style></head><body><div class="controls"><button data-karim-action="print">🖨 طباعة</button><button class="secondary" data-karim-action="closeWindow">إغلاق</button></div><main class="sheet"><header class="head"><img class="doc-logo" src="${esc(getAbsoluteLogoSrc())}" alt="الشعار"><div><h1>${esc(STATE.settings.name||'مطاعم الشرفه العالمي')}</h1><p>نظام إدارة المخازن والمطاعم</p></div></header><div class="doc-title"><h2>إذن صرف مخزن</h2><span class="st">${esc(pStatusAr)}</span></div><section class="meta"><div><b>رقم الإذن</b>#${esc(String(d.id))}</div><div><b>القسم الطالب</b>${esc(dept?dept.name:d.deptName||'—')}</div><div><b>تاريخ الطلب</b>${esc(fD(d.date))}</div><div><b>تاريخ الاعتماد</b>${esc(d.warehouseApprovedAt||d.approvedDate?fD(d.warehouseApprovedAt||d.approvedDate):'—')}</div></section><table><thead><tr><th style="width:36px">#</th><th>الصنف</th><th>الكمية المعتمدة</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${pItems.map(pRow).join('')||'<tr><td colspan="5">لا أصناف</td></tr>'}</tbody><tfoot><tr><td colspan="4">الإجمالي (${pItems.length} صنف)</td><td>${fC(pTotal)}</td></tr></tfoot></table>${pChain.length?`<section class="chain">${pChain.map(c=>`<div><b>${esc(c[0])}</b>${esc(c[1])}<br><small>${esc(c[2]?fDT(c[2]):'')}</small></div>`).join('')}</section>`:''}<div class="notes"><b>ملاحظات الطلب:</b> ${esc(d.notes||'—')}${d.approveNotes?`<br><b>ملاحظات الاعتماد:</b> ${esc(d.approveNotes)}`:''}${d.receiptNotes?`<br><b>ملاحظات الاستلام:</b> ${esc(d.receiptNotes)}`:''}</div><div class="sigs">${sigBlock('توقيع الطالب',null,d.createdBy,d.date)}${sigBlock('توقيع أمين المخزن',d.warehouseApprovalSignatureData,d.warehouseApprovedBy,d.warehouseApprovedAt||d.approvedDate)}${sigBlock('توقيع المستلم',d.kitchenReceiptSignatureData,d.kitchenReceivedBy,d.kitchenReceivedAt)}</div><div class="foot">مستند مخزني معتمد إلكترونيًا — ${esc(STATE.settings.name||'')} — طُبع بتاريخ ${esc(fDT(new Date().toISOString()))}</div></main></body></html>`);
printWindow.document.close();
printWindow.print();
}
// Kitchen Returns
function showKitchenReturnModal(){
const approvedDispatches = STATE.dispatches.filter(d=>d.status==='approved');
if(!approvedDispatches.length){
/* إرجاع مباشر: بلا إذن صرف مسبق — القسم + أصناف المخزون */
const depts=(STATE.departments||[]).filter(d=>!String(d.code||'').startsWith('ys_') && d.code !== 'kitchen' && d.code !== 'external_sales' && d.parent_code !== 'kitchen');
const deptField=isDeptHead()
? `<input type="hidden" id="returnDeptDirect" value="${esc(myDeptCode()||'')}"><div class="fg"><label>القسم المُرجِع</label><input type="text" value="${esc(deptNameByCode(myDeptCode()))}" readonly disabled></div>`
: `<div class="fg"><label>القسم المُرجِع</label><select id="returnDeptDirect" class="u-input">${depts.map((d,i)=>`<option value="${esc(d.code)}" ${i===0?'selected':''}>${esc(d.name||d.code)}</option>`).join('')}</select></div>`;
const invOpts=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (رصيد ${fN(i.qty)} ${esc(i.unit||'')})</option>`).join('');
showModal(`
<h3><i class=ji data-i=undo></i> إرجاع مباشر للمخزن</h3>
<div class="workflow-banner">لا توجد طلبات صرف معتمدة — سيُسجَّل إرجاعًا مباشرًا من القسم إلى المخزن الرئيسي مع عكس مصروف القسم.</div>
${deptField}
<div class="fg"><label>سبب الإرجاع</label>
<select id="returnReason" class="u-input">
<option value="فائض إنتاج">فائض إنتاج</option>
<option value="تغيير قائمة">تغيير قائمة</option>
<option value="انتهاء الوردية">انتهاء الوردية</option>
<option value="خطأ في الصرف">خطأ في الصرف</option>
<option value="أخرى">أخرى</option>
</select></div>
<div id="returnItemsContainer"><div class="edit-row-item">
<select class="ret-item-name u-input-f2">${invOpts||'<option value="">لا أصناف بالمخزن</option>'}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" data-karim-action="kdAct31"><i class=ji data-i=x></i></button>
</div></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" data-karim-action="addDirectReturnItemField"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="fg u-mt16"><label>ملاحظات</label><textarea id="returnNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="submitDirectReturn"><i class=ji data-i=undo></i> تأكيد الإرجاع</button></div>
`);
return;
}
showModal(`
<h3><i class=ji data-i=undo></i> إرجاع من المطبخ للمخزن</h3>
<div class="fg"><label>طلب الصرف</label>
<select id="returnDispatch" class="u-input">
${approvedDispatches.map(d=>`<option value="${d.id}">#${d.id} - ${esc(d.deptName)} - ${fD(d.date)}</option>`).join('')}
</select></div>
<div class="fg"><label>سبب الإرجاع</label>
<select id="returnReason" class="u-input">
<option value="فائض إنتاج">فائض إنتاج</option>
<option value="تغيير قائمة">تغيير قائمة</option>
<option value="انتهاء الوردية">انتهاء الوردية</option>
<option value="خطأ في الصرف">خطأ في الصرف</option>
<option value="أخرى">أخرى</option>
</select></div>
<div id="returnItemsContainer"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" data-karim-action="addReturnItemField"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="fg u-mt16"><label>ملاحظات</label><textarea id="returnNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="submitKitchenReturn"><i class=ji data-i=undo></i> تأكيد الإرجاع</button></div>
`);
refreshReturnItems();
document.getElementById('returnDispatch').addEventListener('change',refreshReturnItems);
}
function refreshReturnItems(){
const dispatchId = document.getElementById('returnDispatch')?.value;
// المعرّف من القاعدة رقم والـdispatchId نص من <select> — المقارنة بالنص
// تحفظ دلالة المقارنة المرنة (==) دون كسر المطابقة.
const dispatch = STATE.dispatches.find(d=>String(d.id)===String(dispatchId));
const container = document.getElementById('returnItemsContainer');
if(!container||!dispatch){return;}
const items = dispatch.approvedItems || dispatch.items || [];
const options = items.map(i=>`<option value="${esc(i.itemName)}" data-unit="${esc(i.unit)}" data-max="${i.approvedQty||i.qty}">${esc(i.itemName)} (${fN(i.approvedQty||i.qty)} ${i.unit})</option>`).join('');
container.innerHTML = `<div class="edit-row-item">
<select class="ret-item-name u-input-f2">${options}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" data-karim-action="kdAct33"><i class=ji data-i=x></i></button>
</div>`;
}
function addReturnItemField(){
const dispatchId = document.getElementById('returnDispatch')?.value;
// المعرّف من القاعدة رقم والـdispatchId نص من <select> — المقارنة بالنص
// تحفظ دلالة المقارنة المرنة (==) دون كسر المطابقة.
const dispatch = STATE.dispatches.find(d=>String(d.id)===String(dispatchId));
const container = document.getElementById('returnItemsContainer');
if(!container||!dispatch){return;}
const items = dispatch.approvedItems || dispatch.items || [];
const options = items.map(i=>`<option value="${esc(i.itemName)}" data-unit="${esc(i.unit)}" data-max="${i.approvedQty||i.qty}">${esc(i.itemName)} (${fN(i.approvedQty||i.qty)} ${i.unit})</option>`).join('');
const div = document.createElement('div');
div.className = 'edit-row-item';
div.innerHTML = `<select class="ret-item-name u-input-f2">${options}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" data-karim-action="kdAct35"><i class=ji data-i=x></i></button>`;
container.appendChild(div);
}
function addDirectReturnItemField(){
const container=document.getElementById('returnItemsContainer');
if(!container){return;}
const invOpts=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (رصيد ${fN(i.qty)} ${esc(i.unit||'')})</option>`).join('');
const div=document.createElement('div');
div.className='edit-row-item';
div.innerHTML=`<select class="ret-item-name u-input-f2">${invOpts}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" data-karim-action="kdAct37"><i class=ji data-i=x></i></button>`;
container.appendChild(div);
}
async function submitDirectReturn(){
const deptCode=document.getElementById('returnDeptDirect')?.value;
const reason=document.getElementById('returnReason')?.value;
const notes=document.getElementById('returnNotes')?.value.trim();
if(!deptCode){ toast('اختر القسم المُرجِع','error'); return; }
const items=[];
document.querySelectorAll('#returnItemsContainer .edit-row-item').forEach(row=>{
const name=row.querySelector('.ret-item-name')?.value;
const qty=parseFloat(row.querySelector('.ret-item-qty')?.value)||0;
if(name&&qty>0){items.push({name,qty});}
});
if(items.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
try{
const result=await apiFetch('/warehouse/returns',{method:'POST',body:JSON.stringify({deptCode,reason,notes,items})});
upsertStateEntity('kitchenReturns',result.return);
(result.stockChanges||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
(result.expenses||[]).forEach(row=>upsertStateEntity('expenses',row));
closeModal(); renderPage();
toast(`تم الإرجاع المباشر وإعادة ${fC(result.totalValue||0)} للمخزن`,'success');
}catch(e){ toast(e.message||'تعذر تنفيذ الإرجاع','error'); }
}
async function submitKitchenReturn(){
const dispatchId = document.getElementById('returnDispatch')?.value;
const dispatch = STATE.dispatches.find(d=>String(d.id)===String(dispatchId));
const reason = document.getElementById('returnReason')?.value;
const notes = document.getElementById('returnNotes')?.value.trim();
if(!dispatch){ toast('اختر طلب صرف','error'); return; }
const items = [];
// Rows are created with class 'edit-row-item' (refreshReturnItems/addReturnItemField) —
// the old '.return-item' selector matched nothing, so kitchen returns were impossible.
document.querySelectorAll('#returnItemsContainer .edit-row-item').forEach(row=>{
const name = row.querySelector('.ret-item-name')?.value;
const qty = parseFloat(row.querySelector('.ret-item-qty')?.value)||0;
if(name && qty>0) {items.push({name,qty});}
});
if(items.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
try{
const result=await apiFetch('/warehouse/returns',{method:'POST',body:JSON.stringify({dispatchId,reason,notes,items})});
upsertStateEntity('kitchenReturns',result.return);
(result.stockChanges||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
(result.expenses||[]).forEach(row=>upsertStateEntity('expenses',row));
closeModal(); renderPage();
toast(`تم الإرجاع وإعادة ${fC(result.totalValue||0)} للمخزن وعكس مصروف القسم`,'success');
addNotification('إرجاع للمخزن',`تم عكس مصروف القسم من طلب الصرف #${dispatch.id}`,'success');
}catch(e){ toast(e.message||'تعذر تنفيذ الإرجاع','error'); }
}
// ============================================
// RECIPES
// ============================================
async function syncRecipeToCashier(recipeId){
  try {
    const result = await apiFetch('/pos/recipes/sync-legacy', {method:'POST', body:JSON.stringify({recipe_id:recipeId})});
    return result?.product || null;
  } catch (e) {
    console.warn('[recipe-sync]', e);
    toast('تم حفظ الوصفة لكن تعذر مزامنتها مع الكاشير','warning');
    return null;
  }
}
function renderRecipes(){
if(!checkMenuAccessLocal('recipes')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
return `<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=utensils></i> الوصفات</h3><button class="btn btn-gold" data-karim-action="showAddRecipeModal"><i class=ji data-i=plus></i> وصفة جديدة</button></div><div class="dept-grid">${STATE.recipes.map(r=>{const d=STATE.departments.find(x=>x.code===r.deptId), catalog=recipeCatalogRow(r.id);return `<div class="mcard recipe-card">${catalog.image_url?`<img class="recipe-thumb" src="${esc(catalog.image_url)}" alt="${esc(r.name)}" loading="lazy">`:''}<div><div class="recipe-name">${esc(r.name)}</div>${d?`<div class="recipe-dept">${deptIcon(d)} ${esc(d.name)}</div>`:''}</div><div class="dept-stats"><div class="dstat"><div class="dstat-lbl">سعر البيع</div><div class="dstat-val c-green">${fC(r.sellingPrice)}</div></div><div class="dstat"><div class="dstat-lbl">التكلفة</div><div class="dstat-val c-red">${fC(r.totalCost)}</div></div><div class="dstat"><div class="dstat-lbl">نسبة التكلفة</div><div class="dstat-val c-orange">${fN(Number(r.costRatio || 0).toFixed(1))}%</div></div></div><div class="fr"><button class="btn btn-gold btn-sm" data-karim-action="openRecipeManager" data-karim-arg0="${r.id}"><i class=ji data-i=settings></i> المكونات والصورة</button><button class="btn btn-sm" data-karim-action="editRecipe" data-karim-arg0="${r.id}"><i class=ji data-i=pencil></i></button><button class="btn btn-red btn-sm" data-karim-action="deleteRecipe" data-karim-arg0="${r.id}"><i class=ji data-i=trash></i></button></div></div>`;}).join('')||'<div class="mcard u-empty">لا توجد وصفات</div>'}</div>`;
}
let recipeManagerState = { recipeId:null, productId:null, recipe:null, ingredients:[], inventory:[], unitOptions:[] };
function recipeCatalogRow(recipeId){ return STATE.recipeCatalog?.[String(recipeId)] || {}; }
function recipeUnitInfo(value){ return recipeManagerState.unitOptions.find(x => x.value === value) || {value, label:value || 'وحدة', family:value === 'g' || value === 'kg' ? 'mass' : value === 'ml' || value === 'l' ? 'volume' : 'count', factor:value === 'kg' || value === 'l' ? 1000 : 1}; }
function recipeNormalizeUnit(value){ const v=String(value||'').trim().toLowerCase(); const aliases={كيلو:'kg',كجم:'kg',كغ:'kg',كيلوجرام:'kg',جرام:'g',غرام:'g',جم:'g',لتر:'l',مل:'ml',وحدة:'piece',قطعة:'piece',حبة:'piece'}; return aliases[v]||v||'piece'; }
function recipeConvertQty(qty, from, to, inventory={}){ const a=recipeUnitInfo(recipeNormalizeUnit(from)), b=recipeUnitInfo(recipeNormalizeUnit(to)), n=Number(qty||0); if(a.family===b.family) {return n*Number(a.factor||1)/Number(b.factor||1);} if((a.family==='mass'&&b.family==='volume')||(a.family==='volume'&&b.family==='mass')){ const weight=Number(inventory?.weight||0)||((b.value==='l')?1:0); if(!(weight>0)) {throw new Error('وحدات غير متوافقة');} const massGrams=weight*1000; return a.family==='mass' ? n*Number(a.factor||1)/massGrams : n*Number(a.factor||1)*massGrams; } throw new Error('وحدات غير متوافقة'); }
function recipeDefaultUnit(inv){ const u=recipeNormalizeUnit(inv?.unit); return recipeManagerState.unitOptions.some(x=>x.value===u) ? u : 'piece'; }
function recipeManagerCost(){ return recipeManagerState.ingredients.reduce((sum,item)=>{ const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(item.inventory_id)); try { const q=recipeConvertQty(item.quantity_per_unit,item.unit,inv?.unit,inv); return sum + q*(1+Number(item.waste_percent||0)/100)*Number(inv?.avgCost||inv?.avg_cost||0); } catch (_) { return sum; } },0); }
function renderRecipeManagerIngredients(){
 const host=document.getElementById('recipe-manager-ingredients'); if(!host){return;}
 host.innerHTML=recipeManagerState.ingredients.map((item,index)=>{ const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(item.inventory_id))||{}; let lineCost, converted='—'; try { const q=recipeConvertQty(item.quantity_per_unit,item.unit,inv.unit,inv); lineCost=q*(1+Number(item.waste_percent||0)/100)*Number(inv.avgCost||0); converted=`${fN(q)} ${esc(inv.unit||'وحدة')}`; } catch (_) { lineCost=NaN; }
 const invFamily=recipeUnitInfo(recipeNormalizeUnit(inv.unit)).family; const currentQty=Number(item.quantity_per_unit||0); const portionControl=invFamily==='count'?`<label class="recipe-portion-field"><span>حصة الاستخدام</span><select data-karim-action="updateRecipeManagerPortion" data-karim-event="change" data-karim-arg0="${index}" data-karim-pass="value"><option value="custom" ${![0.25,0.5,1].includes(currentQty)?'selected':''}>كمية مخصصة</option><option value="0.25" ${currentQty===0.25?'selected':''}>ربع حبة (0.25)</option><option value="0.5" ${currentQty===0.5?'selected':''}>نصف حبة (0.50)</option><option value="1" ${currentQty===1?'selected':''}>حبة كاملة (1)</option></select></label>`:''; const units=recipeManagerState.unitOptions.filter(u=>!inv.unit || u.family===invFamily || (invFamily==='volume'&&u.family==='mass') || (invFamily==='mass'&&u.family==='volume')).map(u=>`<option value="${u.value}" ${recipeNormalizeUnit(item.unit)===u.value?'selected':''}>${esc(u.label)}</option>`).join('');
 return `<article class="recipe-ingredient-card"><div class="recipe-ingredient-main"><div class="recipe-ingredient-title"><span class="recipe-ingredient-icon"><i class=ji data-i=utensils></i></span><div><strong>${esc(inv.name||item.inventory_name||'مكون')}</strong><small>تكلفة ${fC(inv.avgCost||0)} لكل ${esc(inv.unit||'وحدة')}</small></div></div><button class="btn btn-red btn-sm recipe-delete-ingredient" data-karim-action="removeRecipeManagerIngredient" data-karim-arg0="${index}">حذف</button></div><div class="recipe-ingredient-fields">${portionControl}<label><span>الكمية المستخدمة</span><input type="number" min="0.0001" step="0.0001" value="${Number(item.quantity_per_unit||0)}" data-karim-action="updateRecipeManagerQty" data-karim-event="input" data-karim-arg0="${index}" data-karim-pass="value" aria-label="كمية المكون"></label><label><span>وحدة الاستخدام</span><select data-karim-action="updateRecipeManagerUnit" data-karim-event="change" data-karim-arg0="${index}" data-karim-pass="value" aria-label="وحدة المكون">${units}</select></label><label><span>الهدر %</span><input type="number" min="0" max="100" step="0.01" value="${Number(item.waste_percent||0)}" data-karim-action="updateRecipeManagerWaste" data-karim-event="input" data-karim-arg0="${index}" data-karim-pass="value" aria-label="هدر المكون"></label></div><div class="recipe-ingredient-result"><span>سيُخصم من المخزن: <b>${converted}</b></span><strong>${Number.isFinite(lineCost)?fC(lineCost):'وحدات غير متوافقة'}</strong></div></article>`}).join('')||'<div class="text-muted" style="padding:18px;text-align:center">لم تتم إضافة مكونات بعد</div>';
 const count=document.getElementById('recipe-components-count'); if(count) {count.textContent=`${recipeManagerState.ingredients.length} مكونات`;} const cost=recipeManagerCost(), price=Number(recipeManagerState.recipe?.sellingPrice||0), profit=price-cost, margin=price>0?profit/price*100:0; const total=document.getElementById('recipe-manager-total-cost'); if(total){total.innerHTML=fC(cost);} const profitEl=document.getElementById('recipe-manager-profit'); if(profitEl){profitEl.innerHTML=`${fC(profit)} <small>(${fN(margin.toFixed(1))}%)</small>`;} const suggested=document.getElementById('recipe-manager-suggested-price'); if(suggested) {suggested.innerHTML=fC(cost/(1-0.30)||0);}
}
function updateRecipeManagerPortion(index,value){ if(value!=='custom'&&recipeManagerState.ingredients[index]){ recipeManagerState.ingredients[index].quantity_per_unit=Number(value); recipeManagerState.ingredients[index].unit='piece'; } renderRecipeManagerIngredients(); }
function updateRecipeManagerQty(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].quantity_per_unit=Number(value||0);} renderRecipeManagerIngredients(); }
function updateRecipeManagerUnit(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].unit=value;} renderRecipeManagerIngredients(); }
function updateRecipeManagerWaste(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].waste_percent=Number(value||0);} renderRecipeManagerIngredients(); }
function removeRecipeManagerIngredient(index){ recipeManagerState.ingredients.splice(index,1); renderRecipeManagerIngredients(); }
function addRecipeManagerIngredient(){ const id=document.getElementById('recipe-manager-inventory')?.value; if(!id){return;} if(recipeManagerState.ingredients.some(x=>String(x.inventory_id)===String(id))){toast('هذا المكون موجود بالفعل','warning');return;} const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(id)); recipeManagerState.ingredients.push({inventory_id:Number(id),inventory_name:inv?.name,inventory_unit:inv?.unit,quantity_per_unit:1,unit:recipeDefaultUnit(inv),waste_percent:0,notes:null}); renderRecipeManagerIngredients(); }
async function uploadRecipeManagerImage(){ const file=document.getElementById('recipe-manager-image')?.files?.[0]; if(!recipeManagerState.productId){toast('احفظ الوصفة أولاً قبل رفع الصورة','warning');return;} if(!file){toast('اختر صورة أولاً','warning');return;} const form=new FormData();form.append('image',file);showLoad();try{const res=await fetch(`${API_BASE}/pos/products/${recipeManagerState.productId}/image`,{method:'POST',headers:window._jwt?{Authorization:`Bearer ${window._jwt}`}:{},body:form});const data=await res.json().catch(()=>({}));if(!res.ok){throw new Error(data.message||data.error||'تعذر رفع الصورة');}const row=recipeCatalogRow(recipeManagerState.recipeId);row.image_url=data.image_url;STATE.recipeCatalog[String(recipeManagerState.recipeId)]=row;const img=document.getElementById('recipe-manager-image-preview');if(img){img.innerHTML=`<img src="${esc(data.image_url)}" alt="صورة الوصفة">`;}toast('تم حفظ صورة الوصفة في قاعدة البيانات');}catch(e){toast(e.message||'تعذر رفع الصورة','error')}finally{hideLoad();}}
async function openRecipeManager(recipeId){try{showLoad();const sync=await apiFetch('/pos/recipes/sync-legacy',{method:'POST',body:JSON.stringify({recipe_id:recipeId})});const productId=sync.product?.id;if(!productId){throw new Error('تعذر إنشاء صنف الكاشير للوصفة');}const [ingredients,inventory,unitOptions]=await Promise.all([apiFetch(`/pos/products/${productId}/ingredients`),apiFetch('/pos/ingredients'),apiFetch('/pos/recipe-units')]);recipeManagerState={recipeId,productId,recipe:STATE.recipes.find(r=>String(r.id)===String(recipeId)),ingredients:Array.isArray(ingredients)?ingredients:[],inventory:Array.isArray(inventory)?inventory:[],unitOptions:Array.isArray(unitOptions)?unitOptions:[]};const catalog=recipeCatalogRow(recipeId);catalog.product_id=productId;catalog.image_url=sync.product.image_url||catalog.image_url;STATE.recipeCatalog[String(recipeId)]=catalog;const options=recipeManagerState.inventory.map(i=>`<option value="${i.id}">${esc(i.name)} — ${fN(i.avgCost||0)} ${STATE.settings.currency} / ${esc(i.unit||'وحدة')}</option>`).join('');showModal(`<div class="recipe-editor-shell"><header class="recipe-editor-header"><div><span class="recipe-editor-kicker">إدارة قائمة الطعام</span><h3><i class=ji data-i=utensils></i> ${esc(recipeManagerState.recipe?.name||'وصفة جديدة')}</h3><p>اضبط الصورة والمكونات والتكلفة من المخزن في مكان واحد.</p></div><button class="recipe-editor-close" data-karim-action="closeModal" aria-label="إغلاق">×</button></header><section class="recipe-editor-top"><div class="recipe-editor-media"><div id="recipe-manager-image-preview" class="recipe-image-preview">${catalog.image_url?`<img src="${esc(catalog.image_url)}" alt="صورة الوصفة">`:'<div class="recipe-image-empty"><span><i class=ji data-i=camera></i></span><b>لا توجد صورة</b><small>أضف صورة الوجبة لتمييزها في الكاشير</small></div>'}</div><div class="recipe-image-actions"><label class="recipe-file-label">اختيار صورة<input id="recipe-manager-image" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-gold" data-karim-action="uploadRecipeManagerImage">رفع الصورة</button></div></div><div class="recipe-editor-stats"><div class="recipe-stat"><span>سعر البيع</span><strong>${fC(recipeManagerState.recipe?.sellingPrice||0)}</strong></div><div class="recipe-stat"><span>تكلفة الوجبة</span><strong id="recipe-manager-total-cost">0</strong></div><div class="recipe-stat recipe-stat-profit"><span>الربح المتوقع</span><strong id="recipe-manager-profit">0</strong></div><div class="recipe-stat recipe-stat-suggested"><span>سعر مقترح · نسبة تكلفة 30%</span><strong id="recipe-manager-suggested-price">0</strong></div></div></section><section class="recipe-editor-section"><div class="recipe-section-heading"><div><span class="recipe-step">01</span><div><h4>إضافة مكونات الوجبة</h4><p>اختر الصنف من المخزن ثم حدد الكمية ووحدة الاستخدام.</p></div></div><span class="recipe-live-badge">حساب مباشر</span></div><div class="recipe-editor-add"><select id="recipe-manager-inventory"><option value="">اختر مكونًا من المخزن</option>${options}</select><button class="btn btn-gold" data-karim-action="addRecipeManagerIngredient"><i class=ji data-i=plus></i> إضافة مكون</button></div></section><section class="recipe-editor-section recipe-components-section"><div class="recipe-section-heading"><div><span class="recipe-step">02</span><div><h4>مكونات الوصفة</h4><p>كل تكلفة محسوبة بعد التحويل إلى وحدة المخزن.</p></div></div><span class="recipe-components-count" id="recipe-components-count"></span></div><div id="recipe-manager-ingredients" class="recipe-ingredients-list"></div></section><footer class="recipe-editor-footer"><button class="btn recipe-cancel-btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold recipe-save-btn" data-karim-action="saveRecipeManager">حفظ الوصفة والتكلفة</button></footer></div>`,'recipe-manager-modal');renderRecipeManagerIngredients();}catch(e){toast(e.message||'تعذر فتح إدارة الوصفة','error')}finally{hideLoad();}}
async function saveRecipeManager(){const invalid=recipeManagerState.ingredients.some(x=>!Number.isFinite(Number(x.quantity_per_unit))||Number(x.quantity_per_unit)<=0);if(invalid){toast('كل كميات المكونات يجب أن تكون أكبر من صفر','error');return;}try{showLoad();const result=await apiFetch(`/pos/products/${recipeManagerState.productId}/ingredients`,{method:'PUT',body:JSON.stringify({ingredients:recipeManagerState.ingredients})});const recipe=recipeManagerState.recipe,totalCost=Number(result.total_cost||recipeManagerCost()),price=Number(recipe.sellingPrice||0);const saved=await persistUpdate('recipes',recipe.id,{name:recipe.name,deptId:recipe.deptId,sellingPrice:price,totalCost,costRatio:price>0?totalCost/price*100:0});Object.assign(recipe,saved||{totalCost,costRatio:price>0?totalCost/price*100:0});closeModal();await loadData();renderPage();toast(`تم حفظ التكلفة ${fN(totalCost)} ${STATE.settings.currency} والربح ${fN(price-totalCost)} ${STATE.settings.currency}`);}catch(e){toast(e.message||'تعذر حفظ مكونات الوصفة','error')}finally{hideLoad();}}
function showAddRecipeModal(){
const deptOpts=STATE.departments.map(d=>`<option value="${d.code}">${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=plus></i> إضافة وصفة</h3><div class="fg"><label>اسم الوصفة</label><input type="text" id="recipeName"></div><div class="fr"><div class="fg"><label>القسم</label><select id="recDept">${deptOpts}</select></div><div class="fg"><label>سعر البيع</label><input type="number" id="recipePrice" step="0.01"></div></div><div class="fg"><label>التكلفة</label><input type="number" id="recCost" step="0.01"></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="addRecipe"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function addRecipe(){
const name=document.getElementById('recipeName')?.value.trim(),
deptId=document.getElementById('recDept')?.value,
price=parseFloat(document.getElementById('recipePrice')?.value)||0,
cost=parseFloat(document.getElementById('recCost')?.value)||0;
if(!name){ toast('أدخل اسم الوصفة','error'); return; }
const costRatio=price>0?(cost/price*100):0;
let savedRecipe;
await persistCreate('recipes', (saved)=>{ savedRecipe=saved; STATE.recipes.push(saved); }, {id:uid(),name,deptId,sellingPrice:price,totalCost:cost,costRatio});
if(savedRecipe?.id) {await syncRecipeToCashier(savedRecipe.id);}
closeModal(); renderPage();
toast('تم إضافة الوصفة');
}
function editRecipe(id){
const r=STATE.recipes.find(x=>String(x.id)===String(id));
if(!r){return;}
const deptOpts=STATE.departments.map(d=>`<option value="${d.code}" ${r.deptId===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> تعديل وصفة</h3><div class="fg"><label>الاسم</label><input type="text" id="recipeName" value="${esc(r.name)}"></div><div class="fr"><div class="fg"><label>القسم</label><select id="recDept">${deptOpts}</select></div><div class="fg"><label>سعر البيع</label><input type="number" id="recipePrice" value="${r.sellingPrice}" step="0.01"></div></div><div class="fg"><label>التكلفة</label><input type="number" id="recCost" value="${r.totalCost}" step="0.01"></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="updateRecipe" data-karim-arg0="${id}"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function updateRecipe(id){
const r=STATE.recipes.find(x=>String(x.id)===String(id));
if(!r){return;}
const name=document.getElementById('recipeName')?.value.trim();
const deptId=document.getElementById('recDept')?.value;
const sellingPrice=parseFloat(document.getElementById('recipePrice')?.value)||0;
const totalCost=parseFloat(document.getElementById('recCost')?.value)||0;
const costRatio=sellingPrice>0?(totalCost/sellingPrice*100):0;
const savedRecipe = await persistUpdate('recipes', id, {name,deptId,sellingPrice,totalCost,costRatio});
Object.assign(r, savedRecipe || {name,deptId,sellingPrice,totalCost,costRatio});
await syncRecipeToCashier(id);
closeModal(); renderPage();
toast('تم التحديث');
}
async function deleteRecipe(id){
if(!confirm('حذف الوصفة؟')){return;}
await persistRemove('recipes', id);
STATE.recipes=STATE.recipes.filter(r=>String(r.id)!==String(id));
renderPage();
toast('تم الحذف','warning');
}
// ═══ بطاقات تكلفة أمر الإنتاج: البيع الخارجي + البوفيه المفتوح ═══
// الصرف الفعلي (أذون الصرف + مكونات أوامر الإنتاج) مقابل الإيراد الفعلي من الكاشير
let costCardsData=null;
function renderCostCardsSection(){
const monthStart=new Date().toISOString().slice(0,8)+'01';
// التحميل التلقائي بعد رسم الصفحة — بدونه تبقى رسالة «جارٍ التحميل» للأبد
setTimeout(()=>{ if(document.getElementById('costCardsBoard')&&!window.__costCardsLoaded) {window.__costCardsLoaded=true; loadCostCards();} },80);
return `<div class="tbl-wrap u-mt16" id="costCardsWrap"><div class="tbl-hd"><h3><i class=ji data-i=chart></i> بطاقات التكلفة — الصرف الفعلي مقابل الإيراد الفعلي</h3>
<div class="u-row-wrap"><label style="font-size:12px">من</label><input type="date" id="costCardsFrom" value="${monthStart}" data-karim-action="loadCostCards" data-karim-event="change"><label style="font-size:12px">إلى</label><input type="date" id="costCardsTo" value="${new Date().toISOString().slice(0,10)}" data-karim-action="loadCostCards" data-karim-event="change"><button class="btn btn-blue btn-sm" data-karim-action="loadCostCards"><i class=ji data-i=refresh></i> تحديث</button></div></div>
<div id="costCardsBoard"><div class="text-muted u-mt12">جارٍ تحميل بطاقات التكلفة...</div></div></div>`;
}
async function loadCostCards(){
const box=document.getElementById('costCardsBoard');
if(!box){return;}
const from=document.getElementById('costCardsFrom')?.value||'';
const to=document.getElementById('costCardsTo')?.value||'';
try{
costCardsData=await apiFetch(`/kitchen/production/cost-cards?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
box.innerHTML=(costCardsData.cards||[]).map(c=>costCardHtml(c)).join('')||'<div class="text-muted">لا بطاقات</div>';
}catch(e){
const msg=String(e.message||'');
const hint=(msg.includes('404')||msg.includes('NOT_FOUND')||msg.includes('Failed to fetch'))
?'<br><small>لو طلعت الرسالة دي بعد تحديث الصفحة: أعد تشغيل السيرفر على الجهاز الآخر (اقفل KARIMERP.bat وافتحه من جديد) — النقطة الجديدة لسه مش متاحة على السيرفر القديم.</small>':'';
box.innerHTML=`<div style="color:#c0392b">${esc(e.message||'تعذر تحميل بطاقات التكلفة')}${hint}</div>`;
}
}
function costCardHtml(c){
const items=(c.consumption?.items||[]).slice(0,25).map(x=>`<tr><td>${esc(x.name)}</td><td>${fN(x.qty)} ${esc(x.unit||'')}</td><td>${fC(x.cost)}</td><td class="c-red">${fC(x.value)}</td><td class="text-muted">${esc(String(x.date||'').slice(0,10))}</td><td class="text-muted">#${esc(String(x.dispatch_no||''))}</td></tr>`).join('');
const prods=(c.production?.lines||[]).map(p=>`<tr><td>${esc(p.product_name||`دفعة #${p.batch_id}`)}</td><td>${fN(p.allocated_qty)} من ${fN(p.planned_qty)}</td><td class="text-muted">${fC(p.batch_cost)}</td><td class="c-red fw-bold">${fC(p.cost)}</td><td class="text-muted">${esc(String(p.prod_date||'').slice(0,10))}</td></tr>`).join('');
return `<div class="u-mt16" style="background:#fff;border-radius:14px;border-top:4px solid ${esc(c.color||'#c9a227')};box-shadow:0 2px 10px rgba(0,0,0,.06);padding:14px">
<div class="u-row-between"><h4 style="margin:0">${esc(c.icon||'')} ${esc(c.name)} <small class="text-muted">(${esc(c.from)} — ${esc(c.to)})</small></h4>
<button class="btn btn-gold btn-sm" data-karim-action="printCostCard" data-karim-arg0="${esc(c.code)}"><i class=ji data-i=printer></i> طباعة البطاقة</button></div>
<div class="u-mt12" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;text-align:center">
<div style="background:rgba(231,76,60,.06);border-radius:10px;padding:10px"><small style="color:#64748b">الصرف الفعلي (أذون صرف − مرتجعات)</small><b style="display:block;font-size:18px;color:#c0392b">${fC(c.consumption?.gross||0)}</b></div>
<div style="background:rgba(139,92,246,.06);border-radius:10px;padding:10px"><small style="color:#64748b">تكلفة أوامر الإنتاج الموزعة</small><b style="display:block;font-size:18px;color:#8B5CF6">${fC(c.production?.cost||0)}</b></div>
<div style="background:rgba(201,162,39,.08);border-radius:10px;padding:10px"><small style="color:#64748b">الإيراد الفعلي (كاشير القسم)</small><b style="display:block;font-size:18px;color:#9a7417">${fC(c.revenue||0)}</b></div>
<div style="background:rgba(22,163,74,.06);border-radius:10px;padding:10px"><small style="color:#64748b">نسبة الكوست / الصافي</small><b style="display:block;font-size:18px;color:${(c.costRatio||0)>85?'#c0392b':'#16a34a'}">${c.costRatio!=null?fN(c.costRatio)+'%':'—'}</b><small style="color:#16a34a">صافي ${fC(c.net||0)}</small></div>
</div>
${prods?`<div class="tbl-scroll u-mt12"><table><thead><tr><th>أمر إنتاج</th><th>التوزيع</th><th>تكلفة الدفعة كاملة</th><th>نصيب الجهة</th><th>التاريخ</th></tr></thead><tbody>${prods}</tbody></table></div>`:''}
${items?`<div class="tbl-scroll u-mt8"><table><thead><tr><th>الصنف المصروف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>التاريخ</th><th>الإذن</th></tr></thead><tbody>${items}</tbody></table></div><small class="text-muted">المرتجعات المسجلة: ${fC(c.consumption?.returned||0)} (مخصومة) • يُحدَّث سعر الوحدة تلقائيًا من متوسط تكلفة المخزون عند كل إذن صرف</small>`:'<div class="text-muted u-mt8">لا صرف مسجل في هذه الفترة</div>'}
</div>`;
}
function printCostCard(code){
const c=(costCardsData?.cards||[]).find(x=>x.code===code);
if(!c){toast('حمّل البطاقات أولًا','warning');return;}
const win=(window.openInAppReport ? window.openInAppReport('تقرير المطبخ') : window.open('', '_blank'));
if(!win){toast('اسمح بالنوافذ المنبثقة','warning');return;}
const items=(c.consumption?.items||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${fN(x.qty)} ${esc(x.unit||'')}</td><td>${fC(x.cost)}</td><td>${fC(x.value)}</td><td>${esc(String(x.date||'').slice(0,10))}</td><td>#${esc(String(x.dispatch_no||''))}</td></tr>`).join('')||'<tr><td colspan="6">لا صرف</td></tr>';
const prods=(c.production?.lines||[]).map(p=>`<tr><td>${esc(p.product_name||`دفعة #${p.batch_id}`)}</td><td>${fN(p.allocated_qty)}</td><td>${fC(p.batch_cost)}</td><td>${fC(p.cost)}</td><td>${esc(String(p.prod_date||'').slice(0,10))}</td></tr>`).join('')||'';
win.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>بطاقة تكلفة ${esc(c.name)}</title><style>
body{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;padding:0;margin:0;color:#1a1a2e}
.header{background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;padding:20px 28px}
.header h1{margin:0;font-size:20px;color:#f5d76e}.header p{margin:4px 0 0;color:#cbd5e1;font-size:12px}
.container{padding:20px 28px}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.summary .card{background:#fff;border-radius:12px;padding:12px;text-align:center;border-top:3px solid #e2e8f0;box-shadow:0 1px 6px rgba(0,0,0,.05)}
.summary b{display:block;font-size:17px;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:12px}th{background:#0f172a;color:#f5d76e;padding:8px;font-size:11px}td{padding:7px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:12px}
h3{margin:16px 0 0;font-size:14px}
@media print{.header{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><div class="header"><h1>بطاقة تكلفة — ${esc(c.name)}</h1><p>الفترة ${esc(c.from)} — ${esc(c.to)} • ${esc(STATE.settings.name||'')}</p></div>
<div class="container">
<div class="summary"><div class="card"><small>الصرف الفعلي</small><b style="color:#c0392b">${fC(c.consumption?.gross||0)}</b></div><div class="card"><small>تكلفة أوامر الإنتاج</small><b style="color:#8B5CF6">${fC(c.production?.cost||0)}</b></div><div class="card"><small>الإيراد الفعلي</small><b style="color:#9a7417">${fC(c.revenue||0)}</b></div><div class="card"><small>نسبة الكوست</small><b>${c.costRatio!=null?fN(c.costRatio)+'%':'—'}</b><small>الصافي ${fC(c.net||0)}</small></div></div>
${prods?`<h3>أوامر الإنتاج الموزعة على الجهة</h3><table><thead><tr><th>أمر الإنتاج</th><th>الكمية الموزعة</th><th>تكلفة الدفعة</th><th>نصيب الجهة</th><th>التاريخ</th></tr></thead><tbody>${prods}</tbody></table>`:''}
<h3>الصرف المفصل من أذون الصرف</h3><table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>التاريخ</th><th>الإذن</th></tr></thead><tbody>${items}</tbody></table>
<p style="margin-top:14px;text-align:center;color:#94a3b8;font-size:11px">تم التوليد: ${new Date().toLocaleString('ar-EG')}</p>
</div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
win.document.close();
}/* ─── إجراءات مولَّدة (تفويض بدل معالجات سطرية) ─── */
function kdSubmitKitchenProduction() {
    submitKitchenProduction();
}

function kdAct() {
    document.querySelectorAll('.pr-sel').forEach(c=>c.checked=this.checked);
}

function kdAct31() {
    this.closest('.edit-row-item').remove();
}

function kdAct33() {
    this.closest('.edit-row-item').remove();
}

function kdAct35() {
    this.closest('.edit-row-item').remove();
}

function kdAct37() {
    this.closest('.edit-row-item').remove();
}
/** إعادة ضبط نطاق عرض المطبخ (كان معالجًا سطريًا) — صار إجراءً مُسمّى. */
function kitchenResetDisp() {
    window.myDispAll = false;
    window.myDispFrom = today().slice(0, 8) + '01';
    window.myDispTo = today();
    renderPage();
}




export {canEditDispatch, openDispatchEditModal, submitDispatchEdit, dispatchEditRowHtml, prefillDispatchEditRow, collectDispatchItems, kitchenOverviewLoading, refreshKitchenOverview, kitGoSec, kitchenProductionRows, kitchenProductionDestinationsRows, kitchenProductionDestinations, kitchenProductionMaterials, kitchenProductionMaterialRows, showKitchenProductionModal, syncKitchenProduct, setKitchenProductionMaterialField, addKitchenProductionMaterialRow, removeKitchenProductionMaterialRow, renderKitchenProductionMaterialRows, addKitchenProductionDistributionRow, removeKitchenProductionDistributionRow, syncKitchenProductionDestination, setKitchenProductionCustomName, setKitchenProductionDistributionQty, renderKitchenProductionRows, updateKitchenProductionTotal, submitKitchenProduction, kitchenGovernance, kitchenGovernanceLoading, refreshKitchenGovernance, showKitchenAuditCreateModal, createKitchenAudit, openKitchenAuditCount, saveKitchenAuditCount, submitKitchenAudit, approveKitchenAudit, confirmKitchenAuditApproval, renderKitchenGovernance, kitchenTransferStock, kitchenTransferRows, showKitchenStockReceiveModal, addKitchenTransferRow, removeKitchenTransferRow, renderKitchenTransferRows, updateKitchenTransferRow, syncKitchenTransferMax, submitKitchenStockReceive, renderKitchenDispatchRegister, renderKitchenDistributionRegister, dispPrintList, renderKitchen, renderCostCardsSection, loadCostCards, printCostCard, myDeptCode, isDeptHead, deptNameByCode, dispatchChainStage, renderDeptHeadDashboard, loadDeptPanel, renderDispatch, prCanSee, prCanCreate, prCanReceive, prCanChef, prCanGM, prCanCancel, prCanDelete, deletePR, deleteDispatch, prStatusLabel, prStatusClass, refreshPurchaseRequests, renderPRSection, openPRCreateModal, prAddManualRow, confirmPRCreate, openPRChefApproveModal, confirmPRChefApprove, openPRChefRejectModal, confirmPRChefReject, openPRGMApproveModal, confirmPRGMApprove, openPRGMRejectModal, confirmPRGMReject, openPRReceiveModal, prDeliverModeSync, prFreshSuggest, confirmPRReceive, cancelPR, viewPRDetails, printPR, renderKitchenReturnsSection, deleteKitchenReturn, getDispatchDepartments, showDispatchRequestModal, dispRowHtml, updateDispSummary, dispFilterItems, dispHideList, dispPickItem, addDispatchItemField, syncDispatchRowUnit, dispUomChanged, removeDispatchItem, submitDispatchRequest, openChefApproveModal, confirmChefApprove, openChefRejectModal, confirmChefReject, SIGNATURE_PADS, SIGNATURE_DATE_FMT, accountSignatureName, normalizeSigName, signatureNameMatchesAccount, readSignerName, signaturePadMarkup, signatureFont, paintTypedSignature, initSignaturePad, clearSignaturePad, readSignaturePad, afterModalSignatureInit, dispatchStatusLabel, dispatchStatusClass, openApproveModal, confirmApprove, openRejectModal, confirmReject, openReceiveModal, confirmReceive, viewDispatchDetails, printDispatchNote, showKitchenReturnModal, refreshReturnItems, addReturnItemField, addDirectReturnItemField, submitDirectReturn, submitKitchenReturn, syncRecipeToCashier, renderRecipes, recipeManagerState, recipeCatalogRow, recipeUnitInfo, recipeNormalizeUnit, recipeConvertQty, recipeDefaultUnit, recipeManagerCost, renderRecipeManagerIngredients, updateRecipeManagerPortion, updateRecipeManagerQty, updateRecipeManagerUnit, updateRecipeManagerWaste, removeRecipeManagerIngredient, addRecipeManagerIngredient, uploadRecipeManagerImage, openRecipeManager, saveRecipeManager, showAddRecipeModal, addRecipe, editRecipe, updateRecipe, deleteRecipe, kdSubmitKitchenProduction, kdAct, kdAct31, kdAct33, kdAct35, kdAct37, kitchenResetDisp };;;
