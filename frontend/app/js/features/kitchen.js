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
 const materialMessage=kitchenProductionMaterials.length?'اختر المكونات من رصيد مخزن المطبخ':'لا توجد أصناف متاحة في مخزن المطبخ؛ استلم المواد أولًا';
 const destinationOptions=kitchenProductionDestinations();
 kitchenProductionRows=destinationOptions.filter(x=>x.value.startsWith('department|')).slice(0,2).map(x=>({destination:x.value,quantity:''}));
 if(!kitchenProductionRows.length) {kitchenProductionRows=[{destination:'custom|custom|',quantity:''}];}
 kitchenProductionMaterialRows=[{inventory_id:'',quantity:'',waste_percent:'0'}];
 showModal(`<h3><i class=ji data-i=cooking-pot></i> أمر إنتاج وتوزيع المطبخ</h3><p class="text-muted">الأمر مستقل عن الوصفة وعن كتالوج البيع. اكتب اسم المنتج النهائي يدويًا، أو اختر منتجًا مسجلًا اختياريًا، ثم حدد المكونات والكميات من رصيد مخزن المطبخ.</p><div class="fg"><label>اسم المنتج النهائي</label><input type="text" id="kitchenProductionProductName" placeholder="مثال: دجاج مطهي أو صينية لحم"></div><div class="fr"><div class="fg"><label>منتج مسجل اختياري</label><select id="kitchenProductionProduct"><option value="">بدون ربط بمنتج مسجل</option>${products}</select></div><div class="fg"><label>الوحدة</label><input type="text" id="kitchenProductionProductUnit" value="وحدة" placeholder="حبة، كجم، صينية..."></div></div><div class="fg"><label>إجمالي الكمية المنتجة</label><input type="number" id="kitchenProductionQty" min="0.01" step="0.01" placeholder="مثال: 50 حبة" oninput="updateKitchenProductionTotal()"></div><div class="workflow-banner"><strong><i class=ji data-i=package></i> مكونات أمر الإنتاج اليدوي</strong><small style="display:block;margin-top:4px">${esc(materialMessage)}. مثال: أرز 40 كجم، لحم 20 كجم، هالك 5%.</small></div><div id="kitchenProductionMaterialRows"></div><button type="button" class="btn btn-blue btn-sm" onclick="addKitchenProductionMaterialRow()"><i class=ji data-i=plus></i> إضافة مكون</button><div class="workflow-banner u-mt12"><strong><i class=ji data-i=split></i> توزيع المنتج النهائي</strong><small style="display:block;margin-top:4px">يجب أن يساوي مجموع التوزيع إجمالي الإنتاج.</small></div><div id="kitchenProductionDistributionRows"></div><button type="button" class="btn btn-blue btn-sm" onclick="addKitchenProductionDistributionRow()"><i class=ji data-i=plus></i> إضافة جهة</button><div id="kitchenProductionDistributionSummary" class="text-muted u-mt8"></div><div class="fg"><label>ملاحظات الأمر</label><textarea id="kitchenProductionNotes" rows="2" placeholder="وردية الصباح، دفعة الغداء، رقم المناسبة..."></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitKitchenProduction()" ${kitchenProductionMaterials.length?'':'disabled'}>حفظ أمر الإنتاج والتوزيع</button></div>`);
 renderKitchenProductionMaterialRows();renderKitchenProductionRows();
}
function setKitchenProductionMaterialField(index,field,value){if(kitchenProductionMaterialRows[index]){kitchenProductionMaterialRows[index][field]=value;}}
function addKitchenProductionMaterialRow(){kitchenProductionMaterialRows.push({inventory_id:'',quantity:'',waste_percent:'0'});renderKitchenProductionMaterialRows();}
function removeKitchenProductionMaterialRow(index){if(kitchenProductionMaterialRows.length<=1){return;}kitchenProductionMaterialRows.splice(index,1);renderKitchenProductionMaterialRows();}
function renderKitchenProductionMaterialRows(){
 const container=document.getElementById('kitchenProductionMaterialRows');if(!container){return;}
 const options=kitchenProductionMaterials.map(m=>`<option value="${esc(String(m.inventory_id))}">${esc(m.name)} — متاح ${fN(m.available)} ${esc(m.unit||'وحدة')}</option>`).join('');
 container.innerHTML=kitchenProductionMaterialRows.map((row,index)=>`<div class="production-distribution-row fr" style="align-items:end;margin-top:8px"><div class="fg"><label>المكون ${index+1}</label><select onchange="setKitchenProductionMaterialField(${index},'inventory_id',this.value)"><option value="">اختر مكونًا من المخزن</option>${options}</select></div><div class="fg"><label>الكمية</label><input type="number" min="0.001" step="0.001" value="${esc(row.quantity||'')}" placeholder="الكمية" oninput="setKitchenProductionMaterialField(${index},'quantity',this.value)"></div><div class="fg"><label>الهالك %</label><input type="number" min="0" max="100" step="0.01" value="${esc(row.waste_percent||'0')}" oninput="setKitchenProductionMaterialField(${index},'waste_percent',this.value)"></div><button type="button" class="btn btn-red btn-sm" onclick="removeKitchenProductionMaterialRow(${index})"><i class=ji data-i=x></i></button></div>`).join('');
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
 container.innerHTML=kitchenProductionRows.map((row,index)=>{const selected=String(row.destination||'custom|custom|');const parts=selected.split('|');const isCustom=parts[0]==='custom';return `<div class="production-distribution-row fr" data-row-index="${index}" style="align-items:end;margin-top:8px"><div class="fg"><label>الجهة ${index+1}</label><select class="kitchen-production-destination" onchange="syncKitchenProductionDestination(this,${index})">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.label)}</option>`).join('')}</select>${isCustom?`<input class="kitchen-production-custom" type="text" value="${esc(parts[2]||'')}" placeholder="اكتب اسم الجهة" oninput="setKitchenProductionCustomName(${index},this.value)">`:''}</div><div class="fg"><label>الكمية</label><input class="kitchen-production-distribution-qty" type="number" min="0.01" step="0.01" value="${esc(row.quantity||'')}" oninput="setKitchenProductionDistributionQty(${index},this.value)"></div><button type="button" class="btn btn-red btn-sm" onclick="removeKitchenProductionDistributionRow(${index})"><i class=ji data-i=x></i></button></div>`;}).join('');updateKitchenProductionTotal();
}
function updateKitchenProductionTotal(){const total=Number(document.getElementById('kitchenProductionQty')?.value||0),allocated=kitchenProductionRows.reduce((s,r)=>s+Number(r.quantity||0),0),el=document.getElementById('kitchenProductionDistributionSummary');if(el){const diff=Number((total-allocated).toFixed(4));el.innerHTML=`الموزع: <strong>${fN(allocated)}</strong> من <strong>${fN(total)}</strong> ${diff===0?'<span class="c-green">✓ مكتمل</span>':`<span class="c-orange">المتبقي: ${fN(diff)}</span>`}`;}}
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
function showKitchenAuditCreateModal(){showModal(`<h3><i class=ji data-i=clipboard-list></i> إنشاء جرد ذكي للمطبخ</h3><p class="text-muted">سيتم التقاط رصيد مخزن المطبخ الحالي كرصيد نظامي، ثم تدخل الكميات الفعلية قبل الإرسال للاعتماد.</p><div class="workflow-banner"><i class=ji data-i=info></i> إذا ظهر «لا توجد أرصدة في مخزن المطبخ»، افتح سجل أذونات الصرف واستلم إذنًا معتمدًا ووقّعه من المطبخ أولًا.</div><div class="fg"><label>دورية الجرد</label><select id="kitchenAuditPeriod"><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly">شهري</option><option value="custom">فترة مخصصة</option><option value="annual">سنوي</option></select></div><div class="fr"><div class="fg"><label>بداية الفترة</label><input type="date" id="kitchenAuditPeriodStart" value="${today()}"></div><div class="fg"><label>نهاية الفترة</label><input type="date" id="kitchenAuditPeriodEnd" value="${today()}"></div></div><div class="fg"><label>ملاحظات</label><textarea id="kitchenAuditNotes" rows="3" placeholder="وردية، سبب الجرد، أسماء فريق العد..."></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="createKitchenAudit()">إنشاء جلسة الجرد</button></div>`)}
async function createKitchenAudit(){try{showLoad();const audit=await apiFetch('/kitchen/audits',{method:'POST',body:JSON.stringify({period:document.getElementById('kitchenAuditPeriod')?.value,period_start:document.getElementById('kitchenAuditPeriodStart')?.value||today(),period_end:document.getElementById('kitchenAuditPeriodEnd')?.value||today(),notes:document.getElementById('kitchenAuditNotes')?.value||''})});closeModal();await refreshKitchenGovernance();openKitchenAuditCount(audit.id)}catch(e){toast(e.message||'تعذر إنشاء الجرد','error')}finally{hideLoad()}}
function openKitchenAuditCount(id){
 const a=(kitchenGovernance.audits||[]).find(x=>String(x.id)===String(id));if(!a){toast('جلسة الجرد غير موجودة','error');return}
 const items=Array.isArray(a.items)?a.items:[];
 const periodLabel=({daily:'يومي',weekly:'أسبوعي',monthly:'شهري',custom:'مخصص',annual:'سنوي'})[a.period]||a.period;
 const start=String(a.period_start||'').slice(0,10),end=String(a.period_end||'').slice(0,10);
 const distributions=(STATE.kitchenOps?.distributions||[]).filter(x=>{const day=String(x.created_at||'').slice(0,10);return (!start||day>=start)&&(!end||day<=end);});
 const distributionMarkup=`<div class="workflow-banner u-mt12"><strong><i class=ji data-i=split></i> حركة الإنتاج والتوزيع خلال الفترة</strong><div class="tbl-scroll u-mt8"><table><thead><tr><th>المنتج</th><th>الجهة</th><th>الكمية</th></tr></thead><tbody>${distributions.map(x=>`<tr><td>${esc(x.product_name||'—')}</td><td>${esc(x.destination_name||x.destination_code||'—')}</td><td class="c-gold fw-bold">${fN(x.allocated_qty)}</td></tr>`).join('')||'<tr><td colspan="3">لا توجد حركة إنتاج موزعة في هذه الفترة</td></tr>'}</tbody></table></div></div>`;
 showModal(`<h3><i class=ji data-i=calculator></i> جرد ${periodLabel} — ${esc(a.audit_number)}</h3><div class="audit-mobile-note">الفترة: ${esc(String(a.period_start||'—'))} إلى ${esc(String(a.period_end||'—'))}. أدخل الكمية الفعلية لكل صنف.</div>${distributionMarkup}<div class="tbl-scroll tbl-sticky-first"><table class="kitchen-audit-table"><thead><tr><th>الصنف</th><th>الرصيد النظامي</th><th>الفعلي</th><th>الفرق</th></tr></thead><tbody>${items.map(x=>`<tr><td class="fw-bold">${esc(x.item_name||'—')}<small class="text-muted"> ${esc(x.unit||'')}</small></td><td>${fN(x.system_qty)}</td><td><input class="kitchen-count-input" data-item-id="${x.id}" type="number" min="0" step="0.001" value="${Number(x.counted_qty||0)}"></td><td class="audit-variance c-gold">${(Number(x.counted_qty||0)-Number(x.system_qty||0)).toFixed(3)}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد أرصدة في مخزن المطبخ</td></tr>'}</tbody></table></div>${a.status==='draft'?signaturePadMarkup('kitchenAuditSubmitSignature','توقيع مسؤول العد والإرسال'):''}<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button>${a.status==='draft'?`<button class="btn btn-blue" onclick="saveKitchenAuditCount('${a.id}')">حفظ العد</button><button class="btn btn-gold" onclick="submitKitchenAudit('${a.id}')">إرسال بتوقيع</button>`:''}</div>`);if(a.status==='draft'){afterModalSignatureInit('kitchenAuditSubmitSignature');}
}
async function saveKitchenAuditCount(id){const items=[...document.querySelectorAll('.kitchen-count-input')].map(x=>({id:Number(x.dataset.itemId),counted_qty:Number(x.value||0)}));try{showLoad();await apiFetch(`/kitchen/audits/${id}/count`,{method:'POST',body:JSON.stringify({items})});await refreshKitchenGovernance();closeModal();toast('تم حفظ كميات الجرد','success')}catch(e){toast(e.message||'تعذر حفظ العد','error')}finally{hideLoad()}}
async function submitKitchenAudit(id){try{showLoad();const items=[...document.querySelectorAll('.kitchen-count-input')].map(x=>({id:Number(x.dataset.itemId),counted_qty:Number(x.value||0)}));await apiFetch(`/kitchen/audits/${id}/count`,{method:'POST',body:JSON.stringify({items})});const signatureData=readSignaturePad('kitchenAuditSubmitSignature');if(!signatureData){return;}const signerName=readSignerName('kitchenAuditSubmitSignature');if(!signerName){return;}await apiFetch(`/kitchen/audits/${id}/submit`,{method:'POST',body:JSON.stringify({signatureData,signerName})});closeModal();await refreshKitchenGovernance();toast('تم إرسال الجرد للاعتماد','success')}catch(e){toast(e.message||'تعذر إرسال الجرد','error')}finally{hideLoad()}}
async function approveKitchenAudit(id){if(!confirm('سيتم تسجيل فروقات الجرد في دفتر المخزون. هل تريد الاعتماد؟')){return;}showModal(`<h3><i class=ji data-i=pen-tool></i> اعتماد جرد المطبخ</h3><div class="workflow-banner">سيتم تطبيق الفروقات في دفتر المخزون ولا يمكن اعتماد الجرد مرة أخرى.</div>${signaturePadMarkup('kitchenAuditApprovalSignature','توقيع مسؤول اعتماد الجرد')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmKitchenAuditApproval('${id}')">اعتماد وتوقيع</button></div>`);afterModalSignatureInit('kitchenAuditApprovalSignature');}
async function confirmKitchenAuditApproval(id){try{showLoad();const signatureData=readSignaturePad('kitchenAuditApprovalSignature');if(!signatureData){return;}const signerName=readSignerName('kitchenAuditApprovalSignature');if(!signerName){return;}await apiFetch(`/kitchen/audits/${id}/approve`,{method:'POST',body:JSON.stringify({signatureData,signerName})});await refreshKitchenGovernance();closeModal();toast('تم اعتماد الجرد وترحيل الفروقات','success')}catch(e){toast(e.message||'تعذر اعتماد الجرد','error')}finally{hideLoad()}}
function renderKitchenGovernance(){const audits=kitchenGovernance.audits||[],docs=kitchenGovernance.documents||[];const canApprove=['admin','manager','auditor'].includes(STATE.currentUser?.role);return `<div class="kitchen-governance-grid"><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> الجرد الذكي</h3><button class="btn btn-gold btn-sm" onclick="showKitchenAuditCreateModal()"><i class=ji data-i=plus></i> جرد جديد</button></div><div class="tbl-scroll"><table><thead><tr><th>الرقم</th><th>الدورية والفترة</th><th>الأصناف</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${audits.map(a=>`<tr><td class="fw-bold">${esc(a.audit_number)}</td><td>${({daily:'يومي',weekly:'أسبوعي',monthly:'شهري',custom:'مخصص',annual:'سنوي'})[a.period]||a.period}<small class="text-muted">${a.period_start?`<br>${esc(String(a.period_start))} → ${esc(String(a.period_end||a.period_start))}`:''}</small></td><td>${fN(a.total_items)}</td><td><span class="badge ${a.status==='approved'?'bdg-green':a.status==='submitted'?'bdg-orange':'bdg-blue'}">${a.status==='approved'?'معتمد':a.status==='submitted'?'بانتظار الاعتماد':'مسودة'}</span></td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" onclick="openKitchenAuditCount('${a.id}')">عرض/عد</button>${canApprove&&a.status==='submitted'?`<button class="btn btn-green btn-sm" onclick="approveKitchenAudit('${a.id}')">اعتماد</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="text-center">لا توجد جلسات جرد بعد</td></tr>'}</tbody></table></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=package></i> مستندات حركة المطبخ</h3><span class="badge bdg-blue">${fN(docs.length)} مستند</span></div><div class="tbl-scroll"><table><thead><tr><th>المستند</th><th>من</th><th>إلى</th><th>التاريخ</th><th>الأصناف</th></tr></thead><tbody>${docs.map(d=>`<tr><td class="fw-bold">#${esc(String(d.id))}</td><td>${esc(d.source_name||'—')}</td><td>${esc(d.destination_name||'—')}</td><td>${fD(d.created_at)}</td><td>${Array.isArray(d.items)?d.items.map(i=>`${esc(i.item_name||'—')} (${fN(i.received_qty||i.requested_qty)})`).join('، '):'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="text-center">لا توجد تحويلات مسجلة للمطبخ</td></tr>'}</tbody></table></div></div></div>`}

let kitchenTransferStock={source:null,destination:null,items:[]};
let kitchenTransferRows=[];
async function showKitchenStockReceiveModal(){
 try{
  const stock=await apiFetch('/kitchen/stock');
  kitchenTransferStock=stock||{source:null,destination:null,items:[]};
 }catch(e){toast(e.message||'تعذر قراءة أرصدة المخزن الرئيسي','error');return;}
 if(!kitchenTransferStock.source||!kitchenTransferStock.destination){toast('موقع المخزن الرئيسي أو مخزن المطبخ غير مهيأ','error');return;}
 kitchenTransferRows=[{inventory_id:'',qty:''}];
 showModal(`<h3><i class=ji data-i=package></i> استلام مواد في مخزن المطبخ</h3><div class="workflow-banner">هذا المسار الإداري مخصص للتحويلات الاستثنائية فقط. المواد المعتادة للمطبخ تدخل من خلال إذن الصرف المعتمد واستلامه بالتوقيع.</div><div class="text-muted" style="margin-bottom:12px">من: <strong>${esc(kitchenTransferStock.source.name_ar||'المخزن الرئيسي')}</strong> ← إلى: <strong>${esc(kitchenTransferStock.destination.name_ar||'مخزن المطبخ')}</strong></div><div id="kitchenTransferRows"></div><button type="button" class="btn btn-blue btn-sm" onclick="addKitchenTransferRow()"><i class=ji data-i=plus></i> إضافة صنف</button><div class="fg u-mt16"><label>ملاحظات التحويل</label><textarea id="kitchenTransferNotes" rows="2" placeholder="مثال: تجهيز وردية الغداء"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitKitchenStockReceive()"><i class=ji data-i=inbox></i> استلام المواد</button></div>`);
 renderKitchenTransferRows();
}
function addKitchenTransferRow(){kitchenTransferRows.push({inventory_id:'',qty:''});renderKitchenTransferRows();}
function removeKitchenTransferRow(index){if(kitchenTransferRows.length<=1){kitchenTransferRows[0]={inventory_id:'',qty:''};}else{kitchenTransferRows.splice(index,1);}renderKitchenTransferRows();}
function renderKitchenTransferRows(){
 const container=document.getElementById('kitchenTransferRows');if(!container){return;}
 const options=(kitchenTransferStock.items||[]).map(item=>`<option value="${item.inventory_id}" data-max="${item.available}">${esc(item.name)} — متاح ${fN(item.available)} ${esc(item.unit||'وحدة')}</option>`).join('');
 container.innerHTML=kitchenTransferRows.map((row,index)=>`<div class="kitchen-transfer-row" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px"><div style="flex:2;min-width:220px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الصنف</small><select class="u-input kitchen-transfer-item" onchange="updateKitchenTransferRow(${index},'inventory_id',this.value);syncKitchenTransferMax(this)"><option value="">اختر صنفًا من المخزن الرئيسي</option>${options}</select></div><div style="flex:1;min-width:120px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الكمية</small><input class="u-input kitchen-transfer-qty" type="number" min="0.001" step="0.001" value="${row.qty||''}" placeholder="الكمية" onchange="updateKitchenTransferRow(${index},'qty',this.value)"></div><button type="button" class="btn btn-red btn-sm" onclick="removeKitchenTransferRow(${index})" title="حذف"><i class=ji data-i=x></i></button></div>`).join('');
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
    const rows=(STATE.dispatches||[]).filter(d=>{
        const code=String(d.deptCode||d.departmentCode||'').toLowerCase();
        const name=String(d.deptName||d.departmentName||'').toLowerCase();
        return code==='kitchen'||code==='مطبخ'||name.includes('مطبخ')||name.includes('kitchen');
    }).slice().reverse();
    const statusLabel={pending:'بانتظار اعتماد المخزن',approved:'معتمد — بانتظار استلام المطبخ',partially_received:'مستلم جزئيًا',received:'مستلم ومغلق',rejected:'مرفوض من الإدارة'};
    const statusClass={pending:'bdg-orange',approved:'bdg-green',partially_received:'bdg-blue',received:'bdg-green',rejected:'bdg-red'};
    return `<div class="tbl-wrap kitchen-dispatch-register"><div class="tbl-hd"><div><h3><i class=ji data-i=clipboard-list></i> أذونات الصرف الواردة للمطبخ</h3><small class="text-muted">بعد اعتماد المخزن: راجع الكميات، ثم سجّل الاستلام بتوقيع مسؤول المطبخ.</small></div><span class="badge bdg-blue">${fN(rows.length)} إذن</span></div><div class="tbl-scroll"><table><thead><tr><th>الإذن</th><th>الأصناف والكميات</th><th>التاريخ</th><th>الحالة</th><th>إجراء المطبخ</th></tr></thead><tbody>${rows.map(d=>`<tr><td class="fw-bold">#${esc(String(d.id))}</td><td>${(d.items||[]).map(i=>{const cw=i.catchWeightEnabled||i.actualWeight;return `${esc(i.itemName||i.name||'—')} (${fN(i.approvedQty??i.qty)}${cw&&i.packagingQty?` ${esc(i.catchWeightUom||'كجم')} / ${fN(i.packagingQty)} ${esc(i.packagingUom||'كرتون')}`:''})`;}).join('، ')||'—'}</td><td>${fD(d.date)}</td><td><span class="badge ${statusClass[d.status]||'bdg-orange'}">${statusLabel[d.status]||esc(d.status||'غير محدد')}</span>${d.kitchenReceivedBy?`<small class="text-muted" style="display:block;margin-top:4px"><i class=ji data-i=signature></i> ${esc(d.kitchenReceivedBy)}</small>`:''}</td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" onclick="viewDispatchDetails('${esc(String(d.id))}')"><i class=ji data-i=eye></i> عرض</button>${d.status==='approved'&&['admin','manager','kitchen'].includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="openReceiveModal('${esc(String(d.id))}')"><i class=ji data-i=inbox></i> استلام وتوقيع</button>`:''}${['approved','partially_received','received'].includes(d.status)?`<button class="btn btn-sm" onclick="printDispatchNote('${esc(String(d.id))}')"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد أذونات صرف مسجلة للمطبخ بعد</td></tr>'}</tbody></table></div></div>`;
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
   return `<div class="kitchen-page"><div class="kitchen-page-head"><div><div class="eyebrow">KITCHEN PRODUCTION CONTROL</div><h3><i class=ji data-i=chef-hat></i> ${t('kit.title')}</h3><p>${t('kit.sub')}</p></div><div class="kitchen-actions"><button class="btn btn-gold" onclick="showDispatchRequestModal()"><i class=ji data-i=package></i> ${t('kit.req')}</button><button class="btn btn-blue" onclick="showKitchenProductionModal()"><i class=ji data-i=cooking-pot></i> ${t('kit.prod')}</button><button class="btn" onclick="refreshKitchenOverview()"><i class=ji data-i=refresh></i> ${t('act.refresh')}</button></div></div><div class="metrics-grid kitchen-kpis"><div class="mcard"><div class="mcard-label">${t('kit.policy')}</div><div class="mcard-val c-gold" style="font-size:20px">${modeLabel}</div><small class="text-muted">${t('kit.flexNote')}</small></div><div class="mcard"><div class="mcard-label">${t('kit.openProd')}</div><div class="mcard-val c-blue">${fN((ops.batches||[]).filter(b=>['draft','open'].includes(b.status)).length)}</div></div><div class="mcard"><div class="mcard-label">${t('kit.exceptions')}</div><div class="mcard-val c-orange">${fN((ops.exceptions||[]).length)}</div></div><div class="mcard"><div class="mcard-label">${t('kit.pendingReq')}</div><div class="mcard-val c-purple">${fN(pending.length)}</div></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=cooking-pot></i> أوامر الإنتاج</h3></div><div class="tbl-scroll tbl-sticky-first"><table><thead><tr><th>الوصفة</th><th>الموقع</th><th>المخطط</th><th>المنتج</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${(ops.batches||[]).map(b=>`<tr><td class="fw-bold">${esc(b.product_name||'—')}</td><td>${esc(b.location_name||'—')}</td><td>${fN(b.planned_qty)}</td><td class="c-green">${fN(b.produced_qty)}</td><td class="c-gold">${fN(b.remaining_qty)}</td><td><span class="badge ${b.status==='closed'?'bdg-blue':b.status==='cancelled'?'bdg-red':'bdg-green'}">${b.status==='closed'?'مغلق — موزع':b.status==='cancelled'?'ملغى':'مفتوح'}</span></td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد أوامر إنتاج بعد</td></tr>'}</tbody></table></div></div>${renderKitchenDistributionRegister()}<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> استثناءات البيع أو الإنتاج</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السياسة</th><th>السبب</th><th>الحالة</th></tr></thead><tbody>${(ops.exceptions||[]).map(e=>`<tr><td>${esc(e.product_name||'—')}</td><td>${fN(e.quantity)}</td><td>${esc(e.operation_mode)}</td><td>${esc(e.reason)}</td><td><span class="badge bdg-orange">تحتاج مراجعة</span></td></tr>`).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد استثناءات مفتوحة</td></tr>'}</tbody></table></div></div>${renderKitchenDispatchRegister()}${renderKitchenReturnsSection()}${renderPRSection()}${renderKitchenGovernance()}</div>`;
}
// ═══ Task 19: أدوات سلسلة اعتماد طلبات الصرف (رئيس القسم → الشيف العمومي → المخازن) ═══
function myDeptCode(){ return STATE.currentUser?.dept_code || null; }
function isDeptHead(){ return STATE.currentUser?.role==='dept_head'; }
function deptNameByCode(code){ const d=(STATE.departments||[]).find(x=>String(x.code)===String(code)); return d?d.name:(code||'—'); }
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
const mine=STATE.dispatches.filter(d=>String(d.deptCode)===String(my));
const pending=mine.filter(d=>d.status==='pending').length;
const chefOk=mine.filter(d=>d.status==='chef_approved').length;
const awaitingReceive=mine.filter(d=>['approved','partially_received'].includes(d.status)).length;
const received=mine.filter(d=>['received','partially_received'].includes(d.status)).length;
const myCost=deptExpenseBreakdown(my).total;
const myDeptName=deptNameByCode(my)||'قسمك';
// Task 28: بطاقات مصادر الكلفة من الخادم الحي (صرف مخزني / عكس صرف / فروق جرد / يدوي)
let panelHtml='';
if(panel && panel.scope && String(panel.scope.deptCode||'')===String(my||'')){
const src=panel.expenses?.bySource||{};
const labels=panel.expenses?.labels||{};
const card=(key,icon,colorCls)=>{const row=src[key];const total=row?row.total:0;const cnt=row?row.count:0;return `<div class="metric-card-premium"><div class="kpi-top"><span class="kpi-label">${esc(labels[key]||key)}</span><span class="kpi-chip"><i class=ji data-i=${icon}></i></span></div><div class="value ${total<0?'c-red':''}">${fC(total)}</div><div class="trend"><i class=ji data-i=chart></i> ${cnt} حركة</div></div>`;};
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
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">طلباتي بانتظار الشيف</span><span class="kpi-chip"><i class=ji data-i=hourglass></i></span></div><div class="value">${pending}</div><div class="trend"><i class=ji data-i=clipboard-list></i> من إجمالي ${mine.length} طلب</div></div>
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">معتمدة بانتظار المخازن</span><span class="kpi-chip"><i class=ji data-i=circle-check></i></span></div><div class="value">${chefOk}</div><div class="trend"><i class=ji data-i=package></i> جاهزة للصرف</div></div>
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">بانتظار استلام قسمي</span><span class="kpi-chip"><i class=ji data-i=inbox></i></span></div><div class="value">${awaitingReceive}</div><div class="trend"><i class=ji data-i=archive></i> تُستلم في مخزن القسم</div></div>
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">كلفة قسمي (الإجمالي)</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div><div class="value">${fC(myCost)}</div><div class="trend"><i class=ji data-i=chart></i> مستلمة: ${received} طلب</div></div>
</div>
${panelHtml}
<div class="u-row-between" style="margin-top:22px"><h3 class="u-gold-strong"><i class=ji data-i=clipboard-list></i> آخر طلبات ${esc(myDeptName)}</h3><button class="btn btn-gold" onclick="showDispatchRequestModal()"><i class=ji data-i=plus></i> طلب صرف جديد</button></div>
<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>#</th><th>الأصناف</th><th>التاريخ</th><th>المرحلة</th><th>الحالة</th></tr></thead><tbody>${mine.slice(-8).reverse().map(d=>`<tr><td>${esc(String(d.id)).slice(-6)}</td><td>${(d.items||[]).map(i=>`${esc(i.itemName)} (${fN(i.qty)})`).join('، ')}</td><td>${fD(d.date)}</td><td>${esc(dispatchChainStage(d))}</td><td><span class="badge ${dispatchStatusClass(d.status)}">${dispatchStatusLabel(d.status)}</span></td></tr>`).join('')||'<tr><td colspan="5" class="u-empty">لا توجد طلبات بعد — أنشئ طلبك الأول</td></tr>'}</tbody></table></div></div>`;
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
// رئيس القسم يرى طلبات قسمه فقط — باقي الأدوار ترى الكل
const dispatches = [...STATE.dispatches].reverse().filter(d=>isDeptHead()?String(d.deptCode)===String(my):true);
const chefQueue=dispatches.filter(d=>d.status==='pending'&&d.needsChefApproval).length;
const warehouseQueue=dispatches.filter(d=>d.status==='chef_approved'||(d.status==='pending'&&!d.needsChefApproval)).length;
const chainBanner=!isDeptHead()?`<div class="workflow-banner" style="margin-bottom:14px"><i class=ji data-i=clipboard-list></i> سلسلة الاعتماد: <strong>رئيس القسم</strong> ينشئ الطلب ← <strong>الشيف العمومي</strong> يعتمده ← <strong>المخازن</strong> تصرف وتخصم ← القسم يستلم من مخزنه الخاص.</div>`:'';
const canDecideChef=['admin','manager','kitchen'].includes(role);
const canDecideWarehouse=['admin','manager','warehouse'].includes(role);
const canReceive=['admin','manager','kitchen'].includes(role);
return `<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=clipboard-list></i> ${t('pg.dispatch')}${isDeptHead()?` — ${esc(deptNameByCode(my))}`:''}</h3><button class="btn btn-gold" onclick="showDispatchRequestModal()"><i class=ji data-i=package></i> ${t('dsp.new')}</button></div>${chainBanner}${canDecideChef||canDecideWarehouse?`<div class="fr u-mb12"><span class="badge bdg-orange"><i class=ji data-i=chef-hat></i> ${t('dsp.chefWait')}: ${chefQueue}</span><span class="badge bdg-blue"><i class=ji data-i=package></i> ${t('dsp.whWait')}: ${warehouseQueue}</span></div>`:''}<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> ${isDeptHead()?t('dsp.mine'):t('dsp.all')}</h3></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>${t('dsp.dept')}</th><th>${t('dsp.items')}</th><th>${t('dsp.date')}</th><th>${t('dsp.stage')}</th><th>${t('dsp.status')}</th><th>${t('dsp.by')}</th><th>${t('dsp.actions')}</th></tr></thead><tbody>${dispatches.map((d,idx)=>{const canWarehouse=d.status==='pending'&&!d.needsChefApproval||d.status==='chef_approved';return `<tr><td>${idx+1}</td><td class="fw-bold">${esc(d.deptName)}</td><td>${(d.items||[]).map(i=>`${esc(i.itemName)} (${fN(i.qty)})`).join(', ')}</td><td>${fD(d.date)}</td><td>${esc(dispatchChainStage(d))}</td><td><span class="badge ${dispatchStatusClass(d.status)}">${dispatchStatusLabel(d.status)}</span></td><td>${esc(d.createdBy||'—')}${d.creatorRole==='dept_head'?' <span class="badge bdg-purple">رئيس قسم</span>':''}</td><td style="display:flex;gap:6px;flex-wrap:wrap">${d.status==='pending'&&d.needsChefApproval&&canDecideChef?`<button class="btn btn-green btn-sm" onclick="openChefApproveModal('${esc(String(d.id))}')"><i class=ji data-i=chef-hat></i> اعتماد الشيف</button><button type="button" class="btn btn-red btn-sm" onclick="openChefRejectModal('${esc(String(d.id))}')"><i class=ji data-i=circle-x></i> رفض الشيف</button>`:''}${canWarehouse&&canDecideWarehouse&&!['rejected'].includes(d.status)?`<button class="btn btn-green btn-sm" onclick="openApproveModal('${esc(String(d.id))}')"><i class=ji data-i=circle-check></i> اعتماد المخازن</button><button type="button" class="btn btn-red btn-sm" onclick="openRejectModal('${esc(String(d.id))}')"><i class=ji data-i=circle-x></i> رفض وتوقيع</button>`:''}${d.status==='pending'&&canDecideWarehouse?`<button type="button" class="btn btn-sm" onclick="deleteDispatch('${esc(String(d.id))}')" title="حذف طلب معلّق لم يُعتمد بعد"><i class=ji data-i=trash></i> حذف</button>`:''}${d.status==='approved'&&(canReceive||(isDeptHead()&&String(d.deptCode)===String(my)))?`<button type="button" class="btn btn-gold btn-sm" onclick="openReceiveModal('${esc(String(d.id))}')"><i class=ji data-i=inbox></i> استلام وتوقيع</button>`:''}<button type="button" class="btn btn-blue btn-sm" onclick="viewDispatchDetails('${esc(String(d.id))}')"><i class=ji data-i=eye></i> عرض</button>${['approved','partially_received','received'].includes(d.status)?`<button type="button" class="btn btn-sm" onclick="printDispatchNote('${esc(String(d.id))}')"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="8" class="u-empty">لا توجد طلبات</td></tr>'}</tbody></table></div></div>${renderKitchenReturnsSection()}${renderPRSection()}`;
}
// ═══ طلبات شراء النواقص: أمين المخزن ينشئ (تلقائي + يدوي) → الشيف يوقّع → المدير العام يعتمد نهائيًا ═══
// طلب فقط بلا حركة مخزون — كل توقيع مقفل على اسم صاحب الحساب (signerName) ويُتحقق منه في الخادم.
function prCanSee(){ return ['admin','manager','warehouse','kitchen','accountant'].includes(STATE.currentUser?.role); }
function prCanCreate(){ return ['admin','manager','warehouse','kitchen','dept_head'].includes(STATE.currentUser?.role); }
function prCanReceive(){ return ['admin','manager','warehouse'].includes(STATE.currentUser?.role); }
function prCanChef(){ return ['admin','manager','kitchen'].includes(STATE.currentUser?.role); }
function prCanGM(){ return ['admin','manager'].includes(STATE.currentUser?.role); }
function prCanCancel(){ return ['admin','manager','warehouse','kitchen'].includes(STATE.currentUser?.role); }
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
async function deleteDispatch(id){
if(!['admin','manager','warehouse'].includes(STATE.currentUser?.role)){ toast('حذف أذونات الصرف للمخازن والإدارة فقط','error'); return; }
if(!confirm('حذف طلب الصرف المعلق نهائيًا؟ (المعتمد/المستلم لا يُحذف — يُعالج بالإرجاع)')) {return;}
try{ showLoad();
await apiRemove('dispatches', id);
STATE.dispatches=(STATE.dispatches||[]).filter(x=>String(x.id)!==String(id));
closeModal(); renderPage(); toast('حُذف طلب الصرف المعلق','info');
}catch(e){ toast(e.message||'تعذر حذف طلب الصرف','error'); }
finally{ hideLoad(); }
}
function prStatusLabel(s){ return ({pending:'بانتظار الشيف',chef_approved:'اعتمدها الشيف — بانتظار المدير العام',approved:'معتمدة نهائيًا ؟ بانتظار المخزن',fulfilled:'مستلم ومغلق',rejected:'مرفوضة',cancelled:'ملغاة'})[s]||s||'—'; }
function prStatusClass(s){ return s==='approved'?'bdg-green':s==='fulfilled'?'bdg-teal':s==='chef_approved'?'bdg-blue':s==='pending'?'bdg-orange':s==='rejected'?'bdg-red':'bdg-purple'; }
async function refreshPurchaseRequests(){
try{ STATE.purchaseRequests=await apiFetch('/warehouse/purchase-requests'); STATE._prLoaded=true; }
catch(e){ console.warn('[pr] refresh failed:', e.message); }
if(['warehouse','dispatch'].includes(STATE.page)) {renderPage();}
}
function renderPRSection(){
if(!prCanSee()) {return '';}
const rows=(STATE.purchaseRequests||[]).slice().reverse();
const pendChef=rows.filter(r=>r.status==='pending').length;
const pendGM=rows.filter(r=>r.status==='chef_approved').length;
return `<div class="tbl-wrap" style="margin-top:18px"><div class="tbl-hd"><div><h3><i class=ji data-i=shopping-cart></i> طلبات شراء النواقص</h3><small class="text-muted">المطبخ/المخزن ينشئ ← الشيف يوقّع ← المدير العام يعتمد ← المخزن يستلم ويُدخل البضاعة.</small></div><div class="u-row-wrap">${prCanCreate()?`<button class="btn btn-gold btn-sm" onclick="openPRCreateModal()"><i class=ji data-i=plus></i> طلب شراء جديد</button>`:''}<button class="btn btn-blue btn-sm" onclick="refreshPurchaseRequests()"><i class=ji data-i=refresh></i> تحديث</button><span class="badge bdg-orange">بانتظار الشيف: ${fN(pendChef)}</span><span class="badge bdg-blue">بانتظار المدير: ${fN(pendGM)}</span></div></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>الرقم</th><th>الأصناف</th><th>الحالة</th><th>المنشئ</th><th>توقيع الشيف</th><th>اعتماد المدير</th><th>استلام المخزن</th><th>إجراءات</th></tr></thead><tbody>${rows.map((r,idx)=>{const items=Array.isArray(r.items)?r.items:[];return `<tr><td>${idx+1}</td><td class="fw-bold">${esc(r.request_number||('#'+r.id))}</td><td>${items.map(i=>`${esc(i.itemName||i.name||'—')} (${fN(i.requestedQty??i.qty)})`).join('، ')||'—'}</td><td><span class="badge ${prStatusClass(r.status)}">${prStatusLabel(r.status)}</span></td><td>${esc(r.creator_name||'—')}</td><td>${r.chef_approved_name?`<span class="badge bdg-blue">${esc(r.chef_approved_name)}</span>`:'—'}</td><td>${r.gm_approved_name?`<span class="badge bdg-green">${esc(r.gm_approved_name)}</span>`:'—'}</td><td>${r.wh_received_name?`<span class="badge bdg-teal">${esc(r.wh_received_name)}</span>`:'—'}</td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" onclick="viewPRDetails('${esc(String(r.id))}')"><i class=ji data-i=eye></i> عرض</button>${r.status==='pending'&&prCanChef()?`<button class="btn btn-green btn-sm" onclick="openPRChefApproveModal('${esc(String(r.id))}')"><i class=ji data-i=chef-hat></i> توقيع الشيف</button><button class="btn btn-red btn-sm" onclick="openPRChefRejectModal('${esc(String(r.id))}')"><i class=ji data-i=circle-x></i> رفض</button>`:''}${r.status==='chef_approved'&&prCanGM()?`<button class="btn btn-gold btn-sm" onclick="openPRGMApproveModal('${esc(String(r.id))}')"><i class=ji data-i=circle-check></i> اعتماد المدير العام</button><button class="btn btn-red btn-sm" onclick="openPRGMRejectModal('${esc(String(r.id))}')"><i class=ji data-i=circle-x></i> رفض</button>`:''}${r.status==='approved'&&prCanReceive()?`<button class="btn btn-teal btn-sm" onclick="openPRReceiveModal('${esc(String(r.id))}')"><i class=ji data-i=inbox></i> استلام المخزن</button>`:''}${r.status==='pending'&&prCanCreate()||r.status==='chef_approved'&&prCanCancel()?`<button class="btn btn-red btn-sm" onclick="cancelPR('${esc(String(r.id))}')"><i class=ji data-i=x-circle></i> إلغاء</button>`:''}${prCanDelete()&&!['approved','fulfilled'].includes(r.status)?`<button class="btn btn-red btn-sm" onclick="deletePR('${esc(String(r.id))}')"><i class=ji data-i=trash></i> حذف نهائي</button>`:''}${['approved','chef_approved','pending','fulfilled'].includes(r.status)?`<button class="btn btn-sm" onclick="printPR('${esc(String(r.id))}')"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="9" class="u-empty-sm">لا توجد طلبات شراء بعد — أنشئ طلبًا من نواقص المخزن</td></tr>'}</tbody></table></div></div>`;
}
async function openPRCreateModal(){
if(!prCanCreate()){ toast('إنشاء طلبات الشراء للمطبخ والمخازن والإدارة','error'); return; }
try{
showLoad();
const shortages=await apiFetch('/warehouse/purchase-requests/shortages');
const invNames=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">`).join('');
const rowsHtml=(shortages||[]).map((s,idx)=>`<tr><td><input type="checkbox" class="pr-sel" data-idx="${idx}" checked></td><td class="fw-bold">${esc(s.itemName)}</td><td>${esc(s.unit||'')}</td><td class="c-red">${fN(s.currentQty)}</td><td>${fN(s.minQty)}</td><td><input type="number" class="pr-qty" data-idx="${idx}" data-item-id="${s.itemId}" data-name="${esc(s.itemName)}" data-unit="${esc(s.unit||'وحدة')}" min="0" step="0.001" value="${Number(s.suggestedQty||0)}" style="max-width:110px"></td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى) — أضف يدويًا بالأسفل</td></tr>';
PR_SHORT_CACHE=shortages||[];
showModal(`<h3><i class=ji data-i=shopping-cart></i> طلب شراء نواقص جديد</h3><div class="workflow-banner">علّم على أصناف النواقص وعدّل الكمية المطلوبة، أو أضف أصنافًا يدويًا (خضار وغيرها) — بعد الإنشاء يوقّع <strong>الشيف</strong> ثم يعتمد <strong>المدير العام</strong> ثم يستلم <strong>المخزن</strong>.</div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> نواقص المخزن (${fN((shortages||[]).length)})</h3></div><div class="tbl-scroll" style="max-height:300px;overflow:auto"><table><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll('.pr-sel').forEach(c=>c.checked=this.checked)"></th><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>الحد الأدنى</th><th>المطلوب شراؤه</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div><div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=plus></i> إضافة يدوية</h3><button type="button" class="btn btn-blue btn-sm" onclick="prAddManualRow()"><i class=ji data-i=plus></i> صف جديد</button></div><div id="prManualRows"></div><datalist id="prInvNames">${invNames}</datalist></div><div class="fg"><label>القسم الطالب (تُحسب عليه التكلفة عند التسليم المباشر)</label>${isDeptHead()?`<input type="hidden" id="prDept" value="${esc(myDeptCode()||'')}"><input type="text" value="${esc(deptNameByCode(myDeptCode()))}" readonly disabled>`:((STATE.currentUser?.role==='kitchen')?`<input type="hidden" id="prDept" value="kitchen"><input type="text" value="المطبخ" readonly disabled>`:`<select id="prDept">${(STATE.departments||[]).filter(d=>!String(d.code||'').startsWith('ys_') && d.code !== 'kitchen' && d.code !== 'external_sales' && d.parent_code !== 'kitchen').map((d,i)=>`<option value="${esc(d.code)}" ${i===0?'selected':''}>${esc(d.name||d.code)}</option>`).join('')}</select>`)}</div><div class="fg u-mt12"><label>ملاحظات الطلب (اختياري)</label><textarea id="prNotes" rows="2" placeholder="مثال: أولوية للسلطات قبل نهاية الأسبوع"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRCreate()"><i class=ji data-i=shopping-cart></i> إنشاء الطلب</button></div>`);
}catch(e){ toast(e.message||'تعذر جلب النواقص','error'); }
finally{ hideLoad(); }
}
function prAddManualRow(){
const box=document.getElementById('prManualRows'); if(!box) {return;}
const div=document.createElement('div'); div.className='fr u-mt8 pr-manual';
div.innerHTML=`<div class="fg" style="flex:2"><label>الصنف</label><input type="text" class="pr-m-name" list="prInvNames" placeholder="اسم الصنف"></div><div class="fg"><label>الوحدة</label><input type="text" class="pr-m-unit" value="وحدة" style="max-width:90px"></div><div class="fg"><label>الكمية المطلوبة</label><input type="number" class="pr-m-qty" min="0" step="0.001" value="0" style="max-width:110px"></div><button type="button" class="btn btn-red btn-sm" onclick="this.parentElement.remove()" title="حذف الصف"><i class=ji data-i=trash></i></button>`;
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
try{
showLoad();
const saved=await apiFetch('/warehouse/purchase-requests',{method:'POST',body:JSON.stringify({items,notes:document.getElementById('prNotes')?.value.trim()||'',deptCode:document.getElementById('prDept')?.value||''})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage();
toast(`أُنشئ طلب الشراء ${saved.request_number} — بانتظار توقيع الشيف`,'success');
addNotification('طلب شراء نواقص',`${saved.request_number} بانتظار توقيع الشيف`,'info');
}catch(e){ toast(e.message||'تعذر إنشاء طلب الشراء','error'); }
finally{ hideLoad(); }
}
function openPRChefApproveModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const itemsHtml=(Array.isArray(r.items)?r.items:[]).map(i=>`<div style="background:var(--bg3);padding:10px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(i.itemName||i.name)}</strong><span class="badge bdg-blue">${fN(i.requestedQty??i.qty)} ${esc(i.unit||'')}</span></div>${i.currentQty!=null?`<small class="text-muted">الرصيد: ${fN(i.currentQty)} — الحد الأدنى: ${fN(i.minQty??'—')}</small>`:''}</div>`).join('');
showModal(`<h3><i class=ji data-i=chef-hat></i> توقيع الشيف — ${esc(r.request_number||('#'+r.id))}</h3><div class="workflow-banner">توقيعك يحيل الطلب إلى <strong>المدير العام</strong> للاعتماد النهائي — لا يحرك أي مخزون.</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات الشيف (اختياري)</label><textarea id="prChefNotes" rows="2"></textarea></div>${signaturePadMarkup('prChefSignature','توقيع الشيف العمومي — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRChefApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> توقيع وإحالة للمدير العام</button></div>`);
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
showModal(`<h3><i class=ji data-i=circle-x></i> رفض الشيف — ${esc(r.request_number||('#'+r.id))}</h3><div class="fg"><label>سبب الرفض</label><textarea id="prChefRejReason" rows="3" placeholder="مثال: الكمية مبالغ فيها / الصنف متوفر ببديل"></textarea></div>${signaturePadMarkup('prChefRejSignature','توقيع الشيف على الرفض — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmPRChefReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
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
showModal(`<h3><i class=ji data-i=crown></i> اعتماد المدير العام — ${esc(r.request_number||('#'+r.id))}</h3><div class="workflow-banner">وقّع الشيف <strong>${esc(r.chef_approved_name||'—')}</strong> بتاريخ ${esc(fDT(r.chef_approved_at))} — اعتمادك نهائي ويُغلق الطلب (طلب فقط بلا حركة مخزون).</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات المدير العام (اختياري)</label><textarea id="prGMNotes" rows="2"></textarea></div>${signaturePadMarkup('prGMSignature','توقيع المدير العام — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRGMApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> اعتماد نهائي</button></div>`);
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
showModal(`<h3><i class=ji data-i=circle-x></i> رفض المدير العام — ${esc(r.request_number||('#'+r.id))}</h3><div class="fg"><label>سبب الرفض</label><textarea id="prGMRejReason" rows="3"></textarea></div>${signaturePadMarkup('prGMRejSignature','توقيع المدير العام على الرفض — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmPRGMReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
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
function openPRReceiveModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r){return;}
const rows=(Array.isArray(r.items)?r.items:[]).map((i,ix)=>{
return '<div class="edit-row-item" style="flex-wrap:wrap;align-items:flex-end">'
+ '<div style="flex:2;min-width:160px"><strong>' + esc(i.itemName||i.name) + '</strong><br><small class="text-muted">المطلوب: ' + fN(i.requestedQty??i.qty) + ' ' + esc(i.unit||'') + '</small></div>'
+ '<div class="fg" style="min-width:100px"><label>المستلم</label><input type="number" class="pr-recv-qty" data-idx="' + ix + '" value="' + fN(i.requestedQty??i.qty) + '" min="0" step="0.001" style="max-width:100px"></div>'
+ '<div class="fg" style="min-width:100px"><label>سعر الوحدة</label><input type="number" class="pr-recv-cost" data-idx="' + ix + '" value="0" min="0" step="0.01" style="max-width:100px"></div>' + '<label style="min-width:96px;font-size:12px;align-self:center"><input type="checkbox" class="pr-recv-direct" data-idx="' + ix + '"> مباشر للقسم</label></div>';
}).join('');
showModal('<h3><i class=ji data-i=inbox></i> استلام المخزن</h3><div class="workflow-banner">اعتمد المدير العام <strong>' + esc(r.gm_approved_name||'—') + '</strong> — سجّل المستلم فعليًا لكل صنف (صفر للغير مستلم) وسعر الشراء: <strong>البضاعة تدخل المخزون فور التوقيع.</strong></div><div>' + rows + '</div><div class="fg"><label>طريقة التسليم</label><div class="fr"><label><input type="radio" name="prDeliver" value="stock" checked onchange="prDeliverModeSync(this.value)"> دخول المخزن (مخزون)</label><label><input type="radio" name="prDeliver" value="direct" onchange="prDeliverModeSync(this.value)"> تسليم مباشر للقسم (مصروف فوري)</label></div><small class="text-muted">القسم المستلم: ' + esc(r.dept_name||r.dept_code||'—') + '</small></div><div class="fg u-mt12"><label>ملاحظات الاستلام (اختياري)</label><textarea id="prRecvNotes" rows="2"></textarea></div>' + signaturePadMarkup('prRecvSignature','توقيع أمين المخزن — '+esc(accountSignatureName())) + '<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRReceive(\'' + esc(String(id)) + '\')">توقيع ودخول مخزني</button></div>');
afterModalSignatureInit('prRecvSignature');
window._prRecvItems=Array.isArray(r.items)?r.items:[];
prFreshSuggest();
}
function prDeliverModeSync(v){
document.querySelectorAll('.pr-recv-direct').forEach(cb=>{cb.checked=(v==='direct');});
}
function prFreshSuggest(){
const keys=['دجاج','لحم','لحوم','سمك','خضار','طماطم','خيار','بقدونس','فاكه','فواكه','حليب','ألبان','البان','طازج','بيض','كزبرة','نعناع','جرجير','خس','بطاطس','بصل','كبدة','كبد'];
document.querySelectorAll('.pr-recv-direct').forEach((cb,ix)=>{
const nm=String(((window._prRecvItems||[])[ix]||{}).itemName||((window._prRecvItems||[])[ix]||{}).name||'');
if(keys.some(k=>nm.includes(k))){cb.checked=true;}
});
}
async function confirmPRReceive(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r){return;}
const reqItems=Array.isArray(r.items)?r.items:[];
const items=reqItems.map((i,ix)=>{
const q=document.querySelector('.pr-recv-qty[data-idx="' + ix + '"]');
const c=document.querySelector('.pr-recv-cost[data-idx="' + ix + '"]');
const w=document.querySelector('.pr-recv-direct[data-idx="' + ix + '"]');
return {itemName:i.itemName||i.name,receivedQty:Number(q&&q.value),unitCost:Number(c&&c.value)||0,direct:!!(w&&w.checked)};
});
const signatureData=readSignaturePad('prRecvSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prRecvSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch('/warehouse/purchase-requests/' + encodeURIComponent(id) + '/warehouse-receive',{method:'POST',body:JSON.stringify({items:items,deliverMode:((document.querySelector('input[name="prDeliver"]:checked')||{}).value||'stock'),notes:(document.getElementById('prRecvNotes')||{}).value||'',signatureData:signatureData,signerName:signerName})});
upsertStateEntity('purchaseRequests',saved);
((saved&&saved.stockChanges)||[]).forEach(row=>upsertStateEntity('inventory',row));
((saved&&saved.transactions)||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
toast('وقع المخزن ودخلت البضاعة المخزون','success');
}catch(e){ toast(e.message||'تعذر تسجيل الاستلام','error'); }
finally{ hideLoad(); }
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
showModal(`<h3><i class=ji data-i=shopping-cart></i> طلب الشراء ${esc(r.request_number||('#'+r.id))} — <span class="badge ${prStatusClass(r.status)}">${prStatusLabel(r.status)}</span></h3><div class="u-row-wrap" style="margin:8px 0"><span class="badge bdg-blue"><span class="badge bdg-blue">القسم الطالب: ${esc(r.dept_name||r.dept_code||'—')}</span></span>${r.deliver_mode?`<span class="badge ${r.deliver_mode==='direct'?'bdg-gold':'bdg-teal'}">${r.deliver_mode==='direct'?'تسليم مباشر (مصروف فوري)':r.deliver_mode==='mixed'?'تسليم مختلط':'دخول مخزن'}</span>`:''}</div><div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=package></i> الأصناف (${fN(items.length)})</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>المطلوب</th><th>الرصيد وقت الإنشاء</th></tr></thead><tbody>${items.map(i=>`<tr><td class="fw-bold">${esc(i.itemName||i.name)}</td><td>${esc(i.unit||'—')}</td><td class="c-gold fw-bold">${fN(i.requestedQty??i.qty)}</td><td>${i.currentQty!=null?fN(i.currentQty):'—'}</td></tr>`).join('')}</tbody></table></div></div>${r.notes?`<div class="details-item" style="margin-top:10px"><strong>ملاحظات الطلب:</strong><div>${esc(r.notes)}</div></div>`:''}${chain}<div class="modal-footer">${(r.status==='pending'&&prCanCreate()||r.status==='chef_approved'&&prCanCancel())?`<button class="btn btn-red" onclick="closeModal();cancelPR('${esc(String(r.id))}')"><i class=ji data-i=x-circle></i> إلغاء الطلب</button>`:''}${prCanDelete()&&!['approved','fulfilled'].includes(r.status)?`<button class="btn btn-red" onclick="deletePR('${esc(String(r.id))}')"><i class=ji data-i=trash></i> حذف نهائي</button>`:''}<button class="btn btn-blue" onclick="printPR('${esc(String(r.id))}')"><i class=ji data-i=printer></i> طباعة</button><button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>`);
}
function printPR(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const items=Array.isArray(r.items)?r.items:[];
const sigBlock=(label,who,at)=>`<div style="text-align:center;min-width:160px"><div style="height:44px"></div><div style="border-top:1px solid #333;padding-top:5px;font-size:12px;color:#444">${label}${who?`<br><b style="color:#222">${esc(who)}</b>${at?`<br><small>${esc(fDT(at))}</small>`:''}`:'<br>........'}</div></div>`;
const w=window.open('','_blank'); if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>طلب شراء ${esc(r.request_number||'')}</title><style>body{font-family:'Cairo',sans-serif;padding:40px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:8px;text-align:center}th{background:#f0f0f0}</style></head><body><h1 class="u-ta-c">${esc(STATE.settings.name)}</h1><h2 class="u-ta-c">طلب شراء نواقص — ${esc(r.request_number||('#'+r.id))}</h2><p><strong>الحالة:</strong> ${esc(prStatusLabel(r.status))} | <strong>التاريخ:</strong> ${esc(fD(r.created_at))} | <strong>القسم الطالب:</strong> القسم الطالب: ${esc(r.dept_name||r.dept_code||'—')} | <strong>المنشئ:</strong> ${esc(r.creator_name||'—')}</p><table><thead><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية المطلوبة</th></thead><tbody>${items.map((i,ix)=>`<tr><td>${ix+1}</td><td>${esc(i.itemName||i.name)}</td><td>${esc(i.unit||'')}</td><td>${fN(i.requestedQty??i.qty)}</td></tr>`).join('')}</tbody></table><p><strong>ملاحظات:</strong> ${esc(r.notes||'لا توجد')}</p>${r.rejection_reason?`<p><strong>سبب الرفض:</strong> ${esc(r.rejection_reason)} (${esc(r.rejected_name||'—')})</p>`:''}<div style="margin-top:48px"><div style="display:flex;justify-content:space-between;gap:16px">${sigBlock('توقيع أمين المخزن',r.creator_name,r.created_at)}${sigBlock('توقيع الشيف',r.chef_approved_name,r.chef_approved_at)}${sigBlock('اعتماد المدير العام',r.gm_approved_name,r.gm_approved_at)}${sigBlock('استلام المخزن',r.wh_received_name,r.wh_received_at)}</div></div></body></html>`);
w.document.close();
}
function renderKitchenReturnsSection(){
// رئيس القسم يرى مرتجعات قسمه فقط
const returns = (STATE.kitchenReturns||[]).slice().reverse().filter(r=>isDeptHead()?String(r.deptCode)===String(myDeptCode()):true);
const totalValue = returns.reduce((sum,item)=>sum+(parseFloat(item.totalValue)||0),0);
const canReturn=['admin','manager','warehouse','kitchen','dept_head'].includes(STATE.currentUser?.role);
const canDelete=['admin','manager','warehouse'].includes(STATE.currentUser?.role);
return `
<div class="tbl-wrap" style="margin-top:18px">
<div class="tbl-hd"><h3><i class=ji data-i=undo></i> سجل المرتجعات</h3>${canReturn?`<button class="btn btn-gold btn-sm" onclick="showKitchenReturnModal()"><i class=ji data-i=undo></i> إرجاع جديد</button>`:''}</div>
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
${canDelete?`<td><button class="btn btn-red btn-sm" onclick="deleteKitchenReturn('${esc(ret.id)}')" title="حذف المرتجع"><i class=ji data-i=trash></i></button></td>`:''}
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
const deptField=isDeptHead()
 ? `<input type="hidden" id="dispatchDept" value="${esc(myDeptCode()||'')}"><div class="fg"><label>القسم الطالب</label><input type="text" value="${esc(deptNameByCode(myDeptCode()))}" readonly disabled></div><div class="workflow-banner"><i class=ji data-i=chef-hat></i> سيُرسل طلبك إلى <strong>الشيف العمومي</strong> للاعتماد أولًا، ثم إلى <strong>المخازن</strong> للصرف، ويستلمه قسمك من مخزنه الخاص.</div>`
 : `<div class="fg"><label>القسم الطالب</label><select id="dispatchDept">${dispatchDepartments.map((d,i)=>`<option value="${d.code}" ${i===0?'selected':''}>${esc(d.name||d.name_ar||d.code)}</option>`).join('')}</select></div>`;
 showModal(`<h3><i class=ji data-i=package></i> طلب صرف جديد</h3>${deptField}<div class="workflow-banner"><i class=ji data-i=info></i> ابحث عن الصنف وحدد الكمية — أصناف <strong>الوزن المتغير</strong> تُطلب <strong>بالكرتون</strong> ويُحدد وزنها عند الصرف.</div><label style="margin-top:10px">الأصناف المطلوبة <span class="badge bdg-blue" id="dispCount">1</span></label><div id="dispatchItemsContainer">${dispRowHtml()}</div><button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addDispatchItemField()"><i class=ji data-i=plus></i> إضافة صنف</button><div class="callout-gold u-my16"><div class="fw-bold"><i class=ji data-i=clipboard-list></i> ملخص الطلب</div><div class="callout-value u-t14" id="dispSummary">—</div></div><div class="fg u-mt8"><label>ملاحظات</label><textarea id="dispNotes" rows="2" placeholder="ملاحظة للمخزن (اختياري)"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitDispatchRequest()"><i class=ji data-i=upload></i> إرسال الطلب</button></div>`);
updateDispSummary();
}
// صف صنف ببحث فوري (اسم/باركود) بدل القائمة المنسدلة — يعمل مع آلاف الأصناف
function dispRowHtml(){
return `<div class="dispatch-item" style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:10px;border:1px solid var(--border)">
<div style="position:relative;margin-bottom:8px">
<input type="text" class="dispatch-item-search u-input-f2" placeholder="🔍 ابحث: اسم الصنف أو الباركود..." autocomplete="off" oninput="dispFilterItems(this)" onfocus="dispFilterItems(this)" onblur="setTimeout(()=>dispHideList(this),200)" style="width:100%;font-size:15px;padding:10px 12px">
<input type="hidden" class="dispatch-item-name" value="">
<input type="hidden" class="dispatch-item-catch" value="">
<input type="hidden" class="dispatch-item-pkguom" value="">
<div class="dispatch-item-list" style="display:none;position:absolute;top:100%;right:0;left:0;z-index:50;background:var(--bg2);border:1px solid var(--border);border-radius:8px;max-height:240px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.35)"></div>
</div>
<div class="fr" style="align-items:flex-end">
<div class="fg" style="flex:1;min-width:120px"><label>الكمية</label><input type="number" class="dispatch-item-qty u-input-f1" placeholder="الكمية" min="0.001" step="0.001" style="font-size:16px;font-weight:700" oninput="updateDispSummary()"></div>
<div class="fg pkg-wrap" style="flex:1;min-width:120px;display:none"><label>عدد الكراتين *</label><input type="number" class="dispatch-item-pkg u-input-f1" placeholder="عدد الكراتين" min="1" step="1" style="font-size:16px;font-weight:700" oninput="updateDispSummary()"></div>
<div style="display:flex;flex-direction:column;gap:2px;min-width:86px"><span class="row-unit badge bdg-green">قطعة</span><small class="row-avail text-muted"></small><small class="row-cwest text-muted" style="display:none"></small></div>
<button type="button" class="btn btn-sm btn-red" onclick="removeDispatchItem(this)" title="حذف الصنف"><i class=ji data-i=x></i></button>
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
if(boxes>0) {parts.push(`${name}: ${fN(boxes)} ${uom}`);}
}else{
const qty=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
const unit=row.querySelector('.row-unit')?.textContent?.trim()||'';
if(qty>0) {parts.push(`${name}: ${fN(qty)} ${unit}`);}
}
});
const s=document.getElementById('dispSummary');
if(s) {s.innerHTML=parts.length?parts.map(esc).join(' • '):'—';}
}
function dispFilterItems(input){
const row=input?.closest('.dispatch-item'); if(!row) {return;}
const list=row.querySelector('.dispatch-item-list'); if(!list) {return;}
const q=String(input.value||'').trim().toLowerCase();
const matches=(STATE.inventory||[]).filter(i=>!q||String(i.name||'').toLowerCase().includes(q)||(i.barcode&&String(i.barcode).includes(q))).slice(0,30);
list.innerHTML=matches.map(i=>{const cw=i.catch_weight_enabled?1:0;return `<div onmousedown="dispPickItem(this)" data-name="${esc(i.name)}" data-unit="${esc(i.unit||'قطعة')}" data-max="${i.qty}" data-catch="${cw}" data-pkguom="${esc(i.packaging_uom||'كرتون')}" data-avgbox="${i.packaging_qty_per_base||''}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border)"><b>${esc(i.name)}</b>${cw?' <span class="badge bdg-blue">وزن متغير</span>':''}${i.barcode?` <small class="text-muted">${esc(i.barcode)}</small>`:''}<div class="text-muted" style="font-size:11px">متاح: ${fN(i.qty)} ${esc(i.unit||'')}</div></div>`;}).join('')||'<div class="text-muted" style="padding:8px">لا نتائج مطابقة</div>';
list.style.display='';
}
function dispHideList(input){ const l=input?.closest('.dispatch-item')?.querySelector('.dispatch-item-list'); if(l) {l.style.display='none';} }
function dispPickItem(el){
const row=el?.closest('.dispatch-item'); if(!row) {return;}
const isCw=el.dataset.catch==='1';
row.querySelector('.dispatch-item-name').value=el.dataset.name||'';
row.querySelector('.dispatch-item-search').value=el.dataset.name||'';
row.querySelector('.dispatch-item-catch').value=isCw?'1':'';
row.querySelector('.dispatch-item-pkguom').value=el.dataset.pkguom||'كرتون';
const qtyInput=row.querySelector('.dispatch-item-qty');
const pkgInput=row.querySelector('.dispatch-item-pkg');
const pkgWrap=row.querySelector('.pkg-wrap');
const cwNote=row.querySelector('.row-cwest');
if(isCw){
row.querySelector('.row-unit').textContent=el.dataset.pkguom||'كرتون';
if(qtyInput){qtyInput.placeholder='ملاحظة للمخزن (اختياري)';qtyInput.min='0';qtyInput.style.display='none';}
if(pkgWrap){pkgWrap.style.display='';}
if(cwNote){cwNote.style.display='';cwNote.textContent='الوزن يُحدد على الميزان عند الصرف';}
}else{
row.querySelector('.row-unit').textContent=el.dataset.unit||'قطعة';
if(qtyInput){qtyInput.placeholder='الكمية';qtyInput.min='0.001';}
if(pkgWrap){pkgWrap.style.display='none';}
if(pkgInput){pkgInput.value='';}
if(cwNote){cwNote.style.display='none';cwNote.textContent='';}
}
const av=row.querySelector('.row-avail'); if(av) {av.textContent=`متاح: ${fN(el.dataset.max||0)}`;}
el.parentElement.style.display='none';
updateDispSummary();
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
async function submitDispatchRequest(){
const deptCode=document.getElementById('dispatchDept')?.value;
if(!deptCode){ toast('حدد القسم الطالب','error'); return; }
const dept=getDispatchDepartments().find(d=>d.code===deptCode) || {code:deptCode,name:deptNameByCode(deptCode)};
const items=[];
const notes=document.getElementById('dispNotes')?.value.trim();
document.querySelectorAll('.dispatch-item').forEach(row=>{
const name=row.querySelector('.dispatch-item-name')?.value?.trim();
const isCw=row.querySelector('.dispatch-item-catch')?.value==='1';
const pkgUom=row.querySelector('.dispatch-item-pkguom')?.value||'كرتون';
if(isCw){
const boxes=parseInt(row.querySelector('.dispatch-item-pkg')?.value)||0;
const estKg=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
if(name&&boxes>0) {items.push({itemName:name,qty:boxes,unit:pkgUom,packagingQty:boxes,packagingUom:pkgUom,estWeightKg:estKg||null});}
}else{
const qty=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
const unit=row.querySelector('.row-unit')?.textContent?.trim()||'قطعة';
if(name&&qty>0) {items.push({itemName:name,qty,unit});}
}
});
if(items.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
const disp = {id:uid(),deptCode,deptName:dept?.name||'قسم غير معروف',items,status:'pending',date:today(),createdBy:STATE.currentUser?.username||'unknown',notes};
await persistCreate('dispatches', (saved)=>STATE.dispatches.push(saved), disp);
closeModal(); renderPage(); buildNav();
toast(isDeptHead()?'تم إرسال طلب الصرف — بانتظار اعتماد الشيف العمومي':'تم إرسال طلب الصرف');
addNotification('طلب صرف جديد',`طلب صرف من ${dept?.name||'قسم'}${isDeptHead()?' — بانتظار اعتماد الشيف العمومي':''}`,'info');
}
// ═══ Task 19: اعتماد/رفض الشيف العمومي ═══
function openChefApproveModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
const warnings=(d.items||[]).map(item=>{const inv=STATE.inventory.find(i=>i.name===item.itemName);const avail=inv?Number(inv.qty):0;const isCw=Boolean(inv?.catch_weight_enabled);const req=Number(item.qty)||0;return {item,avail,req,short:isCw?false:avail<req,isCw};});
const itemsHtml=warnings.map(w=>`<div style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(w.item.itemName)}</strong>${w.isCw?' <span class="badge bdg-blue">وزن متغير</span>':''}<span class="badge ${w.short?'bdg-red':'bdg-green'}">المتاح: ${fN(w.avail)} كجم</span></div><div class="text-muted" style="margin-top:4px">المطلوب: ${fN(w.req)} ${esc(w.item.unit||'')}${w.isCw?` — الوزن الفعلي من الميزان عند الصرف`:''}</div>${w.short?'<div style="color:var(--orange);margin-top:4px"><i class=ji data-i=alert-triangle></i> الرصيد أقل من المطلوب — المخازن ستقرر الكمية المعتمدة عند الصرف</div>':''}</div>`).join('');
showModal(`<h3><i class=ji data-i=chef-hat></i> اعتماد الشيف العمومي — ${esc(d.deptName)}</h3><div class="workflow-banner">اعتمادك ينقل الطلب إلى <strong>المخازن</strong> للصرف والخصم — لا يُخصم أي مخزون بهذه الخطوة.</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات الشيف (اختياري)</label><textarea id="chefNotes" rows="2"></textarea></div>${signaturePadMarkup('chefApprovalSignature','توقيع الشيف العمومي')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmChefApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> اعتماد وإحالة للمخازن</button></div>`);
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
showModal(`<h3><i class=ji data-i=circle-x></i> رفض الشيف العمومي — ${esc(d.deptName)}</h3><div style="background:rgba(231,76,60,0.1);padding:12px;border-radius:var(--r);margin-bottom:16px"><strong>الأصناف:</strong> ${(d.items||[]).map(i=>esc(i.itemName)).join('، ')}</div><div class="fg"><label>سبب الرفض</label><textarea id="chefRejReason" rows="3" placeholder="مثال: الكمية كبيرة على احتياج القسم / الصنف غير مناسب"></textarea></div>${signaturePadMarkup('chefRejectionSignature','توقيع الشيف العمومي على الرفض')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmChefReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
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
<div>المتاح: ${fN(maxQty)} | المطلوب: ${fN(item.qty)}</div></div>
<div class="fr">
<div class="fg"><label>الكمية المعتمدة</label><input type="number" id="apQty_${idx}" value="${Math.min(item.qty,maxQty)}" step="0.01" min="0" max="${maxQty}" oninput="updateApproveTotal()"></div>
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
<div class="fg"><label>عدد الكراتين المصروفة *</label><input type="number" id="apPkgQty_${idx}" value="${reqBoxes||''}" step="1" min="1" placeholder="عدد الكراتين" oninput="updateApproveTotal()"></div>
<div class="fg"><label>الوزن الفعلي بالكيلو (الميزان) *</label><input type="number" id="apWeight_${idx}" step="0.001" min="0.001" max="${maxQty}" placeholder="أوزن الكراتين وأدخل الوزن" oninput="updateApproveTotal()"></div>
<div class="fg"><label>القيمة (على الفعلي)</label><div id="apVal_${idx}" class="c-gold fw-bold">${fC(0)}</div></div></div>
<div class="text-muted" id="apAvg_${idx}" style="font-size:12px"></div></div>`;
});
showModal(`<h3><i class=ji data-i=circle-check></i> الموافقة على طلب صرف - ${esc(d.deptName)}</h3><div class="workflow-banner">اعتماد المخزن يخصم الكمية من المخزون ويسجل تكلفة القسم في نفس المعاملة.</div><div id="approveItems">${itemsHtml}</div><div class="callout-gold u-my16"><div class="fw-bold"><i class=ji data-i=banknote></i> القيمة الإجمالية</div><div class="callout-value" id="approveTotal">${fC(total)}</div></div><div class="fg"><label>ملاحظات</label><textarea id="approveNotes" rows="2"></textarea></div>${signaturePadMarkup('warehouseApprovalSignature','توقيع أمين المخزن المعتمد')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> تأكيد الموافقة</button></div>`);
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
async function confirmApprove(id){
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
}catch(e){ toast(e.message||'تعذر اعتماد طلب الصرف','error'); }
}catch(err){ console.error('[confirmApprove]',err); toast('خطأ غير متوقع أثناء الاعتماد: '+(err?.message||err),'error'); }
}
function openRejectModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض طلب صرف</h3><div style="background:rgba(231,76,60,0.1);padding:12px;border-radius:var(--r);margin-bottom:16px"><strong>القسم:</strong> ${esc(d.deptName)}<br><strong>الأصناف:</strong> ${d.items.length}</div><div class="fg"><label>سبب الرفض</label><textarea id="rejReason" rows="3"></textarea></div>${signaturePadMarkup('warehouseRejectionSignature','توقيع أمين المخزن على الرفض')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);afterModalSignatureInit('warehouseRejectionSignature');
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
showModal(`<h3><i class=ji data-i=inbox></i> استلام إذن الصرف — ${esc(d.deptName)}</h3><div class="workflow-banner">الاستلام والتوقيع باسم حسابك فقط (<strong>${esc(accountSignatureName()||'—')}</strong>) — لا يمكن توقيع أي اسم آخر. راجع الكميات ثم أكّد. لا يمكن تسجيل الاستلام مرتين.</div><div>${itemsHtml}</div><div class="fg"><label>ملاحظات الاستلام</label><textarea id="receiptNotes" rows="2" placeholder="أي عجز أو تلف أو ملاحظة عند الاستلام"></textarea></div>${signaturePadMarkup('kitchenReceiptSignature','توقيع المستلم — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmReceive('${esc(String(id))}')"><i class=ji data-i=inbox></i> تأكيد الاستلام والتوقيع</button></div>`);
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
showModal(`<h3><i class=ji data-i=clipboard-list></i> تفاصيل طلب الصرف #${d.id}</h3><div class="fr"><div class="details-item"><strong>القسم:</strong><div>${esc(d.deptName)}</div></div><div class="details-item"><strong>الحالة:</strong><div>${statusLabel}</div></div></div><div class="fr"><div class="details-item"><strong>التاريخ:</strong><div>${fD(d.date)}</div></div><div class="details-item"><strong>الطالب:</strong><div>${esc(d.createdBy||'—')}${d.creatorRole==='dept_head'?' <span class="badge bdg-purple">رئيس قسم</span>':''}</div></div></div><div class="details-list" style="margin-top:10px"><div class="details-item"><strong>المرحلة الحالية:</strong><div>${esc(dispatchChainStage(d))}</div></div></div><div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=package></i> التفاصيل</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>${sourceItems.map(item=>{const cw=item.catchWeightEnabled||item.actualWeight;const q=cw&&item.packagingQty?`${fN(item.approvedQty||item.qty||0)} ${esc(item.catchWeightUom||item.unit||'كجم')} <small class="text-muted">(${fN(item.packagingQty)} ${esc(item.packagingUom||'كرتون')})</small>`:`${fN(item.approvedQty||item.qty||0)}`;return `<tr><td class="fw-bold">${esc(item.itemName||item.name)}${cw?' <span class="badge bdg-blue">وزن متغير</span>':''}</td><td>${esc(item.unit||'—')}</td><td>${q}</td><td class="c-gold">${item.approvedValue?fC(item.approvedValue):'—'}</td></tr>`;}).join('')}</tbody></table></div></div><div class="details-list"><div class="details-item"><strong>ملاحظات الطلب:</strong><div>${esc(d.notes||'—')}</div></div>${d.approveNotes?`<div class="details-item"><strong>ملاحظات الاعتماد:</strong><div>${esc(d.approveNotes)}</div></div>`:''}${d.rejectionReason?`<div class="details-item"><strong>سبب الرفض:</strong><div>${esc(d.rejectionReason)}</div></div>`:''}</div>${chefAudit}${receiptAudit}<div class="modal-footer"><button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>`);
}
function printDispatchNote(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
const dept=STATE.departments.find(x=>x.code===d.deptCode);
const printWindow=window.open('','_blank');
if(!printWindow){ toast('اسمح بالنوافذ المنبثقة لطباعة إذن الصرف','warning'); return; }
const sigBlock=(label,dataUrl,who,at)=>`<div style="text-align:center;min-width:170px;flex:1">${dataUrl?`<img src="${dataUrl}" style="height:54px;object-fit:contain;margin-bottom:2px" alt="${label}">`:'<div style="height:54px"></div>'}<div style="border-top:1.5px solid #333;padding-top:5px;font-size:12px;color:#444">${label}${who?`<br><b style="color:#111">${esc(who)}</b>`:''}${at?`<br><small>${esc(at)}</small>`:''}</div></div>`;
const pItems=(d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items)||[];
const pTotal=pItems.reduce((s,i)=>s+Number(i.approvedValue||0),0);
const pStatusAr={pending:'بانتظار الاعتماد',chef_approved:'معتمد من الشيف — بانتظار المخازن',approved:'معتمد من المخازن',partially_received:'مستلم جزئيًا',received:'مستلم',rejected:'مرفوض'}[d.status]||d.status||'—';
const pRow=(item,idx)=>{const cw=item.catchWeightEnabled||item.actualWeight;const qty=item.approvedQty??item.qty??0;const qtyCell=cw&&item.packagingQty?`${fN(qty)} ${esc(item.catchWeightUom||item.unit||'كجم')}<br><small>(${fN(item.packagingQty)} ${esc(item.packagingUom||'كرتون')})</small>`:`${fN(qty)} ${esc(item.unit||'')}`;const price=Number(item.avgCost)||0;return `<tr><td>${idx+1}</td><td style="text-align:right">${esc(item.name||item.itemName)}${cw?' <small>⚖ وزن متغير</small>':''}</td><td>${qtyCell}</td><td>${price?fC(price):'—'}</td><td class="c-gold fw-bold">${item.approvedValue?fC(item.approvedValue):'—'}</td></tr>`;};
const pChain=[d.createdBy?['الطلب',d.createdBy,d.date||d.requestedAt]:null,d.chefApprovedBy?['اعتماد الشيف',d.chefApprovedBy,d.chefApprovedAt]:null,d.warehouseApprovedBy?['اعتماد المخزن',d.warehouseApprovedBy,d.warehouseApprovedAt||d.approvedDate]:null,d.kitchenReceivedBy?['الاستلام',d.kitchenReceivedBy,d.kitchenReceivedAt]:null].filter(Boolean);
printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن صرف #${d.id}</title><style>*{box-sizing:border-box}body{font-family:'Cairo',Tahoma,Arial,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:32px 36px;direction:rtl}.sheet{max-width:800px;margin:auto}.head{display:flex;align-items:center;gap:16px;border-bottom:3px double #b45309;padding-bottom:14px;margin-bottom:16px}.doc-logo{width:74px;height:74px;object-fit:contain;background:#fff;border:2px solid #d4a843;border-radius:14px;padding:5px}.head h1{margin:0;color:#7c3500;font-size:24px}.head p{margin:2px 0;color:#666;font-size:13px}.doc-title{text-align:center;margin:14px 0 4px}.doc-title h2{margin:0;font-size:21px;letter-spacing:.5px}.doc-title .st{display:inline-block;margin-top:6px;padding:3px 14px;border:1.5px solid #b45309;border-radius:20px;font-size:12px;color:#7c3500}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.meta div{border:1px solid #e2d5bd;border-radius:8px;padding:7px 10px;background:#fdf9f0}.meta b{display:block;color:#7c3500;font-size:11px;margin-bottom:2px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#7c3500;color:#fff}td small{color:#555}tfoot td{font-weight:800;background:#fdf3df}.chain{display:flex;gap:8px;margin-top:14px}.chain div{flex:1;border:1px solid #e2d5bd;border-radius:8px;padding:6px;font-size:11px;text-align:center;background:#fdf9f0}.chain b{display:block;color:#7c3500}.notes{margin-top:12px;border:1px dashed #bbb;border-radius:8px;padding:8px 12px;font-size:13px;min-height:44px}.sigs{display:flex;gap:14px;margin-top:34px}.foot{margin-top:18px;text-align:center;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:8px}.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 26px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff;font-weight:700}.controls button.secondary{background:#555}@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:11mm}}</style></head><body><div class="controls"><button onclick="window.print()">🖨 طباعة</button><button class="secondary" onclick="window.close()">إغلاق</button></div><main class="sheet"><header class="head"><img class="doc-logo" src="${esc(getAbsoluteLogoSrc())}" alt="الشعار"><div><h1>${esc(STATE.settings.name||'مطاعم الشرفه العالمي')}</h1><p>نظام إدارة المخازن والمطاعم</p></div></header><div class="doc-title"><h2>إذن صرف مخزن</h2><span class="st">${esc(pStatusAr)}</span></div><section class="meta"><div><b>رقم الإذن</b>#${esc(String(d.id))}</div><div><b>القسم الطالب</b>${esc(dept?dept.name:d.deptName||'—')}</div><div><b>تاريخ الطلب</b>${esc(fD(d.date))}</div><div><b>تاريخ الاعتماد</b>${esc(d.warehouseApprovedAt||d.approvedDate?fD(d.warehouseApprovedAt||d.approvedDate):'—')}</div></section><table><thead><tr><th style="width:36px">#</th><th>الصنف</th><th>الكمية المعتمدة</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${pItems.map(pRow).join('')||'<tr><td colspan="5">لا أصناف</td></tr>'}</tbody><tfoot><tr><td colspan="4">الإجمالي (${pItems.length} صنف)</td><td>${fC(pTotal)}</td></tr></tfoot></table>${pChain.length?`<section class="chain">${pChain.map(c=>`<div><b>${esc(c[0])}</b>${esc(c[1])}<br><small>${esc(c[2]?fDT(c[2]):'')}</small></div>`).join('')}</section>`:''}<div class="notes"><b>ملاحظات الطلب:</b> ${esc(d.notes||'—')}${d.approveNotes?`<br><b>ملاحظات الاعتماد:</b> ${esc(d.approveNotes)}`:''}${d.receiptNotes?`<br><b>ملاحظات الاستلام:</b> ${esc(d.receiptNotes)}`:''}</div><div class="sigs">${sigBlock('توقيع الطالب',null,d.createdBy,d.date)}${sigBlock('توقيع أمين المخزن',d.warehouseApprovalSignatureData,d.warehouseApprovedBy,d.warehouseApprovedAt||d.approvedDate)}${sigBlock('توقيع المستلم',d.kitchenReceiptSignatureData,d.kitchenReceivedBy,d.kitchenReceivedAt)}</div><div class="foot">مستند مخزني معتمد إلكترونيًا — ${esc(STATE.settings.name||'')} — طُبع بتاريخ ${esc(fDT(new Date().toISOString()))}</div></main></body></html>`);
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
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>
</div></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addDirectReturnItemField()"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="fg u-mt16"><label>ملاحظات</label><textarea id="returnNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitDirectReturn()"><i class=ji data-i=undo></i> تأكيد الإرجاع</button></div>
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
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addReturnItemField()"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="fg u-mt16"><label>ملاحظات</label><textarea id="returnNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitKitchenReturn()"><i class=ji data-i=undo></i> تأكيد الإرجاع</button></div>
`);
refreshReturnItems();
document.getElementById('returnDispatch').addEventListener('change',refreshReturnItems);
}
function refreshReturnItems(){
const dispatchId = document.getElementById('returnDispatch')?.value;
const dispatch = STATE.dispatches.find(d=>d.id==dispatchId);
const container = document.getElementById('returnItemsContainer');
if(!container||!dispatch){return;}
const items = dispatch.approvedItems || dispatch.items || [];
const options = items.map(i=>`<option value="${esc(i.itemName)}" data-unit="${esc(i.unit)}" data-max="${i.approvedQty||i.qty}">${esc(i.itemName)} (${fN(i.approvedQty||i.qty)} ${i.unit})</option>`).join('');
container.innerHTML = `<div class="edit-row-item">
<select class="ret-item-name u-input-f2">${options}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>
</div>`;
}
function addReturnItemField(){
const dispatchId = document.getElementById('returnDispatch')?.value;
const dispatch = STATE.dispatches.find(d=>d.id==dispatchId);
const container = document.getElementById('returnItemsContainer');
if(!container||!dispatch){return;}
const items = dispatch.approvedItems || dispatch.items || [];
const options = items.map(i=>`<option value="${esc(i.itemName)}" data-unit="${esc(i.unit)}" data-max="${i.approvedQty||i.qty}">${esc(i.itemName)} (${fN(i.approvedQty||i.qty)} ${i.unit})</option>`).join('');
const div = document.createElement('div');
div.className = 'edit-row-item';
div.innerHTML = `<select class="ret-item-name u-input-f2">${options}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>`;
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
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>`;
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
return `<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=utensils></i> الوصفات</h3><button class="btn btn-gold" onclick="showAddRecipeModal()"><i class=ji data-i=plus></i> وصفة جديدة</button></div><div class="dept-grid">${STATE.recipes.map(r=>{const d=STATE.departments.find(x=>x.code===r.deptId), catalog=recipeCatalogRow(r.id);return `<div class="mcard recipe-card">${catalog.image_url?`<img class="recipe-thumb" src="${esc(catalog.image_url)}" alt="${esc(r.name)}" loading="lazy">`:''}<div><div class="recipe-name">${esc(r.name)}</div>${d?`<div class="recipe-dept">${deptIcon(d)} ${esc(d.name)}</div>`:''}</div><div class="dept-stats"><div class="dstat"><div class="dstat-lbl">سعر البيع</div><div class="dstat-val c-green">${fC(r.sellingPrice)}</div></div><div class="dstat"><div class="dstat-lbl">التكلفة</div><div class="dstat-val c-red">${fC(r.totalCost)}</div></div><div class="dstat"><div class="dstat-lbl">نسبة التكلفة</div><div class="dstat-val c-orange">${fN(Number(r.costRatio || 0).toFixed(1))}%</div></div></div><div class="fr"><button class="btn btn-gold btn-sm" onclick="openRecipeManager('${r.id}')"><i class=ji data-i=settings></i> المكونات والصورة</button><button class="btn btn-sm" onclick="editRecipe('${r.id}')"><i class=ji data-i=pencil></i></button><button class="btn btn-red btn-sm" onclick="deleteRecipe('${r.id}')"><i class=ji data-i=trash></i></button></div></div>`;}).join('')||'<div class="mcard u-empty">لا توجد وصفات</div>'}</div>`;
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
 host.innerHTML=recipeManagerState.ingredients.map((item,index)=>{ const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(item.inventory_id))||{}; let lineCost=0, converted='—'; try { const q=recipeConvertQty(item.quantity_per_unit,item.unit,inv.unit,inv); lineCost=q*(1+Number(item.waste_percent||0)/100)*Number(inv.avgCost||0); converted=`${fN(q)} ${esc(inv.unit||'وحدة')}`; } catch (_) { lineCost=NaN; }
 const invFamily=recipeUnitInfo(recipeNormalizeUnit(inv.unit)).family; const currentQty=Number(item.quantity_per_unit||0); const portionControl=invFamily==='count'?`<label class="recipe-portion-field"><span>حصة الاستخدام</span><select onchange="updateRecipeManagerPortion(${index},this.value)"><option value="custom" ${![0.25,0.5,1].includes(currentQty)?'selected':''}>كمية مخصصة</option><option value="0.25" ${currentQty===0.25?'selected':''}>ربع حبة (0.25)</option><option value="0.5" ${currentQty===0.5?'selected':''}>نصف حبة (0.50)</option><option value="1" ${currentQty===1?'selected':''}>حبة كاملة (1)</option></select></label>`:''; const units=recipeManagerState.unitOptions.filter(u=>!inv.unit || u.family===invFamily || (invFamily==='volume'&&u.family==='mass') || (invFamily==='mass'&&u.family==='volume')).map(u=>`<option value="${u.value}" ${recipeNormalizeUnit(item.unit)===u.value?'selected':''}>${esc(u.label)}</option>`).join('');
 return `<article class="recipe-ingredient-card"><div class="recipe-ingredient-main"><div class="recipe-ingredient-title"><span class="recipe-ingredient-icon"><i class=ji data-i=utensils></i></span><div><strong>${esc(inv.name||item.inventory_name||'مكون')}</strong><small>تكلفة ${fC(inv.avgCost||0)} لكل ${esc(inv.unit||'وحدة')}</small></div></div><button class="btn btn-red btn-sm recipe-delete-ingredient" onclick="removeRecipeManagerIngredient(${index})">حذف</button></div><div class="recipe-ingredient-fields">${portionControl}<label><span>الكمية المستخدمة</span><input type="number" min="0.0001" step="0.0001" value="${Number(item.quantity_per_unit||0)}" oninput="updateRecipeManagerQty(${index},this.value)" aria-label="كمية المكون"></label><label><span>وحدة الاستخدام</span><select onchange="updateRecipeManagerUnit(${index},this.value)" aria-label="وحدة المكون">${units}</select></label><label><span>الهدر %</span><input type="number" min="0" max="100" step="0.01" value="${Number(item.waste_percent||0)}" oninput="updateRecipeManagerWaste(${index},this.value)" aria-label="هدر المكون"></label></div><div class="recipe-ingredient-result"><span>سيُخصم من المخزن: <b>${converted}</b></span><strong>${Number.isFinite(lineCost)?fC(lineCost):'وحدات غير متوافقة'}</strong></div></article>`}).join('')||'<div class="text-muted" style="padding:18px;text-align:center">لم تتم إضافة مكونات بعد</div>';
 const count=document.getElementById('recipe-components-count'); if(count) {count.textContent=`${recipeManagerState.ingredients.length} مكونات`;} const cost=recipeManagerCost(), price=Number(recipeManagerState.recipe?.sellingPrice||0), profit=price-cost, margin=price>0?profit/price*100:0; const total=document.getElementById('recipe-manager-total-cost'); if(total){total.innerHTML=fC(cost);} const profitEl=document.getElementById('recipe-manager-profit'); if(profitEl){profitEl.innerHTML=`${fC(profit)} <small>(${fN(margin.toFixed(1))}%)</small>`;} const suggested=document.getElementById('recipe-manager-suggested-price'); if(suggested) {suggested.innerHTML=fC(cost/(1-0.30)||0);}
}
function updateRecipeManagerPortion(index,value){ if(value!=='custom'&&recipeManagerState.ingredients[index]){ recipeManagerState.ingredients[index].quantity_per_unit=Number(value); recipeManagerState.ingredients[index].unit='piece'; } renderRecipeManagerIngredients(); }
function updateRecipeManagerQty(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].quantity_per_unit=Number(value||0);} renderRecipeManagerIngredients(); }
function updateRecipeManagerUnit(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].unit=value;} renderRecipeManagerIngredients(); }
function updateRecipeManagerWaste(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].waste_percent=Number(value||0);} renderRecipeManagerIngredients(); }
function removeRecipeManagerIngredient(index){ recipeManagerState.ingredients.splice(index,1); renderRecipeManagerIngredients(); }
function addRecipeManagerIngredient(){ const id=document.getElementById('recipe-manager-inventory')?.value; if(!id){return;} if(recipeManagerState.ingredients.some(x=>String(x.inventory_id)===String(id))){toast('هذا المكون موجود بالفعل','warning');return;} const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(id)); recipeManagerState.ingredients.push({inventory_id:Number(id),inventory_name:inv?.name,inventory_unit:inv?.unit,quantity_per_unit:1,unit:recipeDefaultUnit(inv),waste_percent:0,notes:null}); renderRecipeManagerIngredients(); }
async function uploadRecipeManagerImage(){ const file=document.getElementById('recipe-manager-image')?.files?.[0]; if(!recipeManagerState.productId){toast('احفظ الوصفة أولاً قبل رفع الصورة','warning');return;} if(!file){toast('اختر صورة أولاً','warning');return;} const form=new FormData();form.append('image',file);showLoad();try{const res=await fetch(`${API_BASE}/pos/products/${recipeManagerState.productId}/image`,{method:'POST',headers:window._jwt?{Authorization:`Bearer ${window._jwt}`}:{},body:form});const data=await res.json().catch(()=>({}));if(!res.ok){throw new Error(data.message||data.error||'تعذر رفع الصورة');}const row=recipeCatalogRow(recipeManagerState.recipeId);row.image_url=data.image_url;STATE.recipeCatalog[String(recipeManagerState.recipeId)]=row;const img=document.getElementById('recipe-manager-image-preview');if(img){img.innerHTML=`<img src="${esc(data.image_url)}" alt="صورة الوصفة">`;}toast('تم حفظ صورة الوصفة في قاعدة البيانات');}catch(e){toast(e.message||'تعذر رفع الصورة','error')}finally{hideLoad();}}
async function openRecipeManager(recipeId){try{showLoad();const sync=await apiFetch('/pos/recipes/sync-legacy',{method:'POST',body:JSON.stringify({recipe_id:recipeId})});const productId=sync.product?.id;if(!productId){throw new Error('تعذر إنشاء صنف الكاشير للوصفة');}const [ingredients,inventory,unitOptions]=await Promise.all([apiFetch(`/pos/products/${productId}/ingredients`),apiFetch('/pos/ingredients'),apiFetch('/pos/recipe-units')]);recipeManagerState={recipeId,productId,recipe:STATE.recipes.find(r=>String(r.id)===String(recipeId)),ingredients:Array.isArray(ingredients)?ingredients:[],inventory:Array.isArray(inventory)?inventory:[],unitOptions:Array.isArray(unitOptions)?unitOptions:[]};const catalog=recipeCatalogRow(recipeId);catalog.product_id=productId;catalog.image_url=sync.product.image_url||catalog.image_url;STATE.recipeCatalog[String(recipeId)]=catalog;const options=recipeManagerState.inventory.map(i=>`<option value="${i.id}">${esc(i.name)} — ${fN(i.avgCost||0)} ${STATE.settings.currency} / ${esc(i.unit||'وحدة')}</option>`).join('');showModal(`<div class="recipe-editor-shell"><header class="recipe-editor-header"><div><span class="recipe-editor-kicker">إدارة قائمة الطعام</span><h3><i class=ji data-i=utensils></i> ${esc(recipeManagerState.recipe?.name||'وصفة جديدة')}</h3><p>اضبط الصورة والمكونات والتكلفة من المخزن في مكان واحد.</p></div><button class="recipe-editor-close" onclick="closeModal()" aria-label="إغلاق">×</button></header><section class="recipe-editor-top"><div class="recipe-editor-media"><div id="recipe-manager-image-preview" class="recipe-image-preview">${catalog.image_url?`<img src="${esc(catalog.image_url)}" alt="صورة الوصفة">`:'<div class="recipe-image-empty"><span><i class=ji data-i=camera></i></span><b>لا توجد صورة</b><small>أضف صورة الوجبة لتمييزها في الكاشير</small></div>'}</div><div class="recipe-image-actions"><label class="recipe-file-label">اختيار صورة<input id="recipe-manager-image" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-gold" onclick="uploadRecipeManagerImage()">رفع الصورة</button></div></div><div class="recipe-editor-stats"><div class="recipe-stat"><span>سعر البيع</span><strong>${fC(recipeManagerState.recipe?.sellingPrice||0)}</strong></div><div class="recipe-stat"><span>تكلفة الوجبة</span><strong id="recipe-manager-total-cost">0</strong></div><div class="recipe-stat recipe-stat-profit"><span>الربح المتوقع</span><strong id="recipe-manager-profit">0</strong></div><div class="recipe-stat recipe-stat-suggested"><span>سعر مقترح · نسبة تكلفة 30%</span><strong id="recipe-manager-suggested-price">0</strong></div></div></section><section class="recipe-editor-section"><div class="recipe-section-heading"><div><span class="recipe-step">01</span><div><h4>إضافة مكونات الوجبة</h4><p>اختر الصنف من المخزن ثم حدد الكمية ووحدة الاستخدام.</p></div></div><span class="recipe-live-badge">حساب مباشر</span></div><div class="recipe-editor-add"><select id="recipe-manager-inventory"><option value="">اختر مكونًا من المخزن</option>${options}</select><button class="btn btn-gold" onclick="addRecipeManagerIngredient()"><i class=ji data-i=plus></i> إضافة مكون</button></div></section><section class="recipe-editor-section recipe-components-section"><div class="recipe-section-heading"><div><span class="recipe-step">02</span><div><h4>مكونات الوصفة</h4><p>كل تكلفة محسوبة بعد التحويل إلى وحدة المخزن.</p></div></div><span class="recipe-components-count" id="recipe-components-count"></span></div><div id="recipe-manager-ingredients" class="recipe-ingredients-list"></div></section><footer class="recipe-editor-footer"><button class="btn recipe-cancel-btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold recipe-save-btn" onclick="saveRecipeManager()">حفظ الوصفة والتكلفة</button></footer></div>`,'recipe-manager-modal');renderRecipeManagerIngredients();}catch(e){toast(e.message||'تعذر فتح إدارة الوصفة','error')}finally{hideLoad();}}
async function saveRecipeManager(){const invalid=recipeManagerState.ingredients.some(x=>!Number.isFinite(Number(x.quantity_per_unit))||Number(x.quantity_per_unit)<=0);if(invalid){toast('كل كميات المكونات يجب أن تكون أكبر من صفر','error');return;}try{showLoad();const result=await apiFetch(`/pos/products/${recipeManagerState.productId}/ingredients`,{method:'PUT',body:JSON.stringify({ingredients:recipeManagerState.ingredients})});const recipe=recipeManagerState.recipe,totalCost=Number(result.total_cost||recipeManagerCost()),price=Number(recipe.sellingPrice||0);const saved=await persistUpdate('recipes',recipe.id,{name:recipe.name,deptId:recipe.deptId,sellingPrice:price,totalCost,costRatio:price>0?totalCost/price*100:0});Object.assign(recipe,saved||{totalCost,costRatio:price>0?totalCost/price*100:0});closeModal();await loadData();renderPage();toast(`تم حفظ التكلفة ${fN(totalCost)} ${STATE.settings.currency} والربح ${fN(price-totalCost)} ${STATE.settings.currency}`);}catch(e){toast(e.message||'تعذر حفظ مكونات الوصفة','error')}finally{hideLoad();}}
function showAddRecipeModal(){
const deptOpts=STATE.departments.map(d=>`<option value="${d.code}">${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=plus></i> إضافة وصفة</h3><div class="fg"><label>اسم الوصفة</label><input type="text" id="recipeName"></div><div class="fr"><div class="fg"><label>القسم</label><select id="recDept">${deptOpts}</select></div><div class="fg"><label>سعر البيع</label><input type="number" id="recipePrice" step="0.01"></div></div><div class="fg"><label>التكلفة</label><input type="number" id="recCost" step="0.01"></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="addRecipe()"><i class=ji data-i=save></i> حفظ</button></div>`);
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
showModal(`<h3><i class=ji data-i=pencil></i> تعديل وصفة</h3><div class="fg"><label>الاسم</label><input type="text" id="recipeName" value="${esc(r.name)}"></div><div class="fr"><div class="fg"><label>القسم</label><select id="recDept">${deptOpts}</select></div><div class="fg"><label>سعر البيع</label><input type="number" id="recipePrice" value="${r.sellingPrice}" step="0.01"></div></div><div class="fg"><label>التكلفة</label><input type="number" id="recCost" value="${r.totalCost}" step="0.01"></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="updateRecipe('${id}')"><i class=ji data-i=save></i> حفظ</button></div>`);
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

export { kitchenOverviewLoading, refreshKitchenOverview, kitchenProductionRows, kitchenProductionDestinationsRows, kitchenProductionDestinations, kitchenProductionMaterials, kitchenProductionMaterialRows, showKitchenProductionModal, setKitchenProductionMaterialField, addKitchenProductionMaterialRow, removeKitchenProductionMaterialRow, renderKitchenProductionMaterialRows, addKitchenProductionDistributionRow, removeKitchenProductionDistributionRow, syncKitchenProductionDestination, setKitchenProductionCustomName, setKitchenProductionDistributionQty, renderKitchenProductionRows, updateKitchenProductionTotal, submitKitchenProduction, kitchenGovernance, kitchenGovernanceLoading, refreshKitchenGovernance, showKitchenAuditCreateModal, createKitchenAudit, openKitchenAuditCount, saveKitchenAuditCount, submitKitchenAudit, approveKitchenAudit, confirmKitchenAuditApproval, renderKitchenGovernance, kitchenTransferStock, kitchenTransferRows, showKitchenStockReceiveModal, addKitchenTransferRow, removeKitchenTransferRow, renderKitchenTransferRows, updateKitchenTransferRow, syncKitchenTransferMax, submitKitchenStockReceive, renderKitchenDispatchRegister, renderKitchenDistributionRegister, renderKitchen, myDeptCode, isDeptHead, deptNameByCode, dispatchChainStage, renderDeptHeadDashboard, loadDeptPanel, renderDispatch, prCanSee, prCanCreate, prCanReceive, prCanChef, prCanGM, prCanCancel, prCanDelete, deletePR, deleteDispatch, prStatusLabel, prStatusClass, refreshPurchaseRequests, renderPRSection, openPRCreateModal, prAddManualRow, confirmPRCreate, openPRChefApproveModal, confirmPRChefApprove, openPRChefRejectModal, confirmPRChefReject, openPRGMApproveModal, confirmPRGMApprove, openPRGMRejectModal, confirmPRGMReject, openPRReceiveModal, prDeliverModeSync, prFreshSuggest, confirmPRReceive, cancelPR, viewPRDetails, printPR, renderKitchenReturnsSection, deleteKitchenReturn, getDispatchDepartments, showDispatchRequestModal, dispRowHtml, updateDispSummary, dispFilterItems, dispHideList, dispPickItem, addDispatchItemField, syncDispatchRowUnit, removeDispatchItem, submitDispatchRequest, openChefApproveModal, confirmChefApprove, openChefRejectModal, confirmChefReject, SIGNATURE_PADS, SIGNATURE_DATE_FMT, accountSignatureName, normalizeSigName, signatureNameMatchesAccount, readSignerName, signaturePadMarkup, signatureFont, paintTypedSignature, initSignaturePad, clearSignaturePad, readSignaturePad, afterModalSignatureInit, dispatchStatusLabel, dispatchStatusClass, openApproveModal, confirmApprove, openRejectModal, confirmReject, openReceiveModal, confirmReceive, viewDispatchDetails, printDispatchNote, showKitchenReturnModal, refreshReturnItems, addReturnItemField, addDirectReturnItemField, submitDirectReturn, submitKitchenReturn, syncRecipeToCashier, renderRecipes, recipeManagerState, recipeCatalogRow, recipeUnitInfo, recipeNormalizeUnit, recipeConvertQty, recipeDefaultUnit, recipeManagerCost, renderRecipeManagerIngredients, updateRecipeManagerPortion, updateRecipeManagerQty, updateRecipeManagerUnit, updateRecipeManagerWaste, removeRecipeManagerIngredient, addRecipeManagerIngredient, uploadRecipeManagerImage, openRecipeManager, saveRecipeManager, showAddRecipeModal, addRecipe, editRecipe, updateRecipe, deleteRecipe };
