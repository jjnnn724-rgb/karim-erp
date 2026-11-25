import{b as oe}from"./dispatches-gImUwWNO.js";import{a as O}from"./inventory-register-DFBdSf96.js";import{X as D,W as u,N as f,U as V,Z as T,V as i,$ as h,M as b,a3 as Y,Y as E,a1 as ce,a2 as le,f as pe,g as de,b6 as ue}from"./index-CkubfgIH.js";import{p as L}from"./print-viewer-Bw_bntpC.js";const he=["admin","manager","warehouse","kitchen","sous_chef","dept_head"],ge=["admin","manager","kitchen","sous_chef"],G=["admin","manager","warehouse"],me=["admin","manager","kitchen","sous_chef"],fe=["kitchen","sous_chef","admin","manager"],be=["admin","manager"];function Be(e){return{id:e.id===null||e.id===void 0?"":String(e.id),status:e.status===null||e.status===void 0?"":String(e.status),needsChefApproval:!!e.needsChefApproval,deptCode:e.deptCode===null||e.deptCode===void 0?"":String(e.deptCode),creatorUserId:e.creatorUserId===null||e.creatorUserId===void 0?"":String(e.creatorUserId),hasReceipt:!!(e.kitchenReceivedAt||e.kitchenReceivedBy||Array.isArray(e.receivedItems)&&e.receivedItems.length>0)}}const ve={shop:"CAF",caf:"CAF",ca1:"NAS",nas:"NAS",juice:"G",g:"G",service:"hot_hall",hot_hall:"hot_hall",kitchen:"kitchen",storeroom:"storeroom",external_sales:"external_sales",salads:"salads",sweets:"sweets",bakery:"bakery",hot_kitchen:"hot_kitchen",butcher:"butcher",fnb:"fnb",open_buffet:"open_buffet",kstore:"kstore"};function M(e){const t=String(e??"").trim().toLowerCase();return(ve[t]||t).toLowerCase()}function ye(e){return String(e?.deptCode??"").split(",").map(t=>t.trim().toLowerCase()).filter(Boolean)}function K(e,t){const a=ye(e);if(a.length===0)return!1;const n=String(t.deptCode??"").trim().toLowerCase();if(!n)return!1;const s=M(n);return a.some(r=>{const d=M(r);return r===n||r===s||d===n||d===s})}function Fe(e){return f(e,he)}function qe(e,t){return t.status==="pending"&&t.needsChefApproval&&f(e,ge)}function Ue(e,t){return(t.status==="pending"&&!t.needsChefApproval||t.status==="chef_approved")&&f(e,G)}function ze(e,t){return e==="admin"?!0:t.status==="pending"&&f(e,G)}function Le(e,t,a){return t.status!=="approved"&&t.status!=="partially_received"?!1:f(e,me)?!0:e==="dept_head"&&K(a,t)}function Me(e,t,a){return t.status!=="pending"&&t.status!=="chef_approved"?!1:f(e,fe)||e==="dept_head"&&K(a,t)?!0:t.creatorUserId!==""&&t.creatorUserId===String(a?.id??"")}function We(e,t){return t.status==="approved"&&!t.hasReceipt&&f(e,be)}const o={chooseDept:"حدد القسم الطالب",addOneItem:"أضف صنفًا واحدًا على الأقل",createSent:"تم إرسال طلب الصرف",createSentChef:"تم إرسال طلب الصرف — بانتظار اعتماد الشيف العمومي",createDuplicate:"الطلب مسجل بالفعل — لم يتكرر",createFailed:"تعذر إرسال طلب الصرف — راجع أرصدة المخزن",editNoItems:"اكتب صنفًا واحدًا على الأقل باسم وكمية صحيحة",editSuccess:"تم تعديل الإذن بنجاح",editChefReset:"تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة",editFailed:"فشل تعديل الإذن",reopenReasonRequired:"أدخل سبب إرجاع الإذن للمخازن",reopenSuccess:"تم إرجاع الإذن للمخازن وعكس أثر الصرف — يمكنك تعديله وإعادة اعتماده",reopenFailed:"تعذر إرجاع الإذن للمخازن",chefApproved:"تم اعتماد الطلب وإحالته للمخازن",chefApproveFailed:"تعذر اعتماد الطلب",chefRejected:"تم رفض الطلب وسيظهر لرئيس القسم",chefRejectFailed:"تعذر رفض الطلب",reasonRequired:"أدخل سبب الرفض",approveSuccessPrefix:"تمت الموافقة وحُسبت مصاريف القسم بقيمة",approveFailed:"تعذر اعتماد طلب الصرف",approveInProgress:"الإذن قيد الاعتماد فعلًا — لا تضغط مجددًا",approvedQtyInvalid:"تحقق من الكميات المعتمدة",approvedEmpty:"تحقق من البيانات",rejected:"تم رفض الطلب",rejectFailed:"تعذر رفض طلب الصرف",received:"تم تسجيل استلام المطبخ بالتوقيع",receiveFailed:"تعذر تسجيل استلام المطبخ",receiveQtyInvalid:"تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة",deletePendingConfirm:"حذف طلب الصرف المعلق نهائيًا؟ (المعتمد/المستلم لا يُحذف إلا بواسطة مدير النظام — حذف نهائي موثّق)",deletePendingSuccess:"حُذف طلب الصرف المعلق",deleteFinalSuccess:"حُذف إذن الصرف نهائيًا (موثّق باسم مدير النظام)",deleteFailed:"تعذر حذف الإذن",signerMissing:"اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع",signNoInk:"تعذر رسم التوقيع — راجع خانة التوقيع"};function R(e){return String(e.name??"").trim()}function $(e){const t=Number(e.qty);return Number.isFinite(t)&&t>0?t:0}function xe(e){if(e.length===0)return o.addOneItem;for(const t of e){const a=R(t),n=$(t);if(!a||n<=0)return o.addOneItem;const s=Number(t.mainQty)||0;if(!(s>0))return`لا يوجد أي رصيد من "${a}" في المخزن — لا يُقبل في طلب صرف`;if(n>s+1e-6)return`الرصيد غير كافٍ من "${a}": المتاح ${O(s)} فقط ولا يمكن طلب ${O(n)}`}return""}function He(e,t,a){return e!=="dept_head"&&!String(t??"").trim()?o.chooseDept:xe(a)}function Ve(e){return e.filter(a=>R(a)!==""&&$(a)>0).length>0?"":o.editNoItems}function Ye(e){const t=e.role==="dept_head"?"":String(e.deptCode??"").trim(),a=String(e.deptName??"").trim(),n=e.items.map(s=>({itemName:R(s),qty:$(s),unit:String(s.unit??"").trim()})).filter(s=>s.itemName!==""&&s.qty>0);return{...t?{deptCode:t}:{},...a?{deptName:a}:{},items:n,notes:String(e.notes??"").trim(),status:"pending",date:e.date}}function Ge(e){const t=e.items.map(n=>({itemName:R(n),qty:$(n),unit:String(n.unit??"").trim()})).filter(n=>n.itemName!==""&&n.qty>0),a=e.role==="dept_head"?"":String(e.deptCode??"").trim();return{items:t,...a?{deptCode:a}:{},reason:String(e.reason??"").trim()}}function Se(e){return e!==null&&typeof e=="object"?e:{}}function Ke(e,t={}){if(!Array.isArray(e))return[];const a=t.approved===!0,n=[];for(const s of e){const r=Se(s),d=String(r.itemName??r.name??"").trim();if(!d)continue;const m=a?r.approvedQty??r.qty:r.qty,x=Number(m),S=Number(r.packagingQty),N=!!(r.catchWeightEnabled||r.actualWeight||r.packagingQty||r.estWeightKg||r.packagingUom&&Number(r.packagingQty)>0);n.push({name:d,unit:String(r.unit??"").trim(),qty:Number.isFinite(x)&&x>0?x:0,catchWeight:N,packagingQty:Number.isFinite(S)&&S>0?S:0,packagingUom:String(r.packagingUom??"كرتون").trim()||"كرتون"})}return n}function Je(e){const t=e.approvedItems;return Array.isArray(t)&&t.length>0?t:e.items}function J(e){const t=Number(e);return Number.isFinite(t)&&t>=0?t:Number.NaN}function Xe(e){let t=!1;for(const a of e){if(a.catchWeight){const r=Number(a.actualWeight)||0,d=Number(a.packagingQty)||0;if(!(r>0))return`أدخل الوزن الفعلي بالكيلو للصنف "${a.name}"`;if(!(d>0))return`أدخل عدد الكراتين المصروفة للصنف "${a.name}"`;const m=Number(a.max);if(Number.isFinite(m)&&r>m)return`الوزن الفعلي من "${a.name}" أكبر من المتوفر (${O(m)} كجم)`;t=!0;continue}const n=J(a.approvedQty);if(Number.isNaN(n))return o.approvedQtyInvalid;const s=Number(a.max);if(Number.isFinite(s)&&n>s)return`الكمية المعتمدة من "${a.name}" أكبر من المتوفر`;n>0&&(t=!0)}return t?"":o.approvedEmpty}function Ze(e){const t=[];for(const a of e){if(a.catchWeight){const s=Number(a.actualWeight)||0,r=Number(a.packagingQty)||0;t.push({name:a.name,itemName:a.name,unit:"kg",requestedQty:s,approvedQty:s,actualWeight:s,packagingQty:r,packagingUom:a.packagingUom??"كرتون",catchWeightUom:"kg"});continue}const n=J(a.approvedQty);Number.isNaN(n)||n<=0||t.push({name:a.name,itemName:a.name,unit:a.unit,requestedQty:a.requestedQty,approvedQty:n,actualWeight:null,packagingQty:null,packagingUom:null,catchWeightUom:"kg"})}return t}function et(e){for(const t of e){const a=Number(t.receivedQty);if(!Number.isFinite(a)||a<0||a>t.approvedQty)return o.receiveQtyInvalid;if(t.catchWeight){const n=Number(t.approvedPackagingQty)||0,s=t.receivedPackagingQty,r=s===""||s===null||s===void 0?n:Number(s);if(!Number.isFinite(r)||r<0||r>n)return o.receiveQtyInvalid}}return""}function tt(e){return e.map(t=>{const a=Number(t.receivedQty)||0;if(!t.catchWeight)return{itemName:t.name,receivedQty:a,notes:""};const n=Number(t.approvedPackagingQty)||0,s=t.receivedPackagingQty,r=s===""||s===null||s===void 0?n:Number(s)||0;return{itemName:t.name,receivedQty:a,receivedPackagingQty:r,notes:""}})}function at(e,t){return String(t??"").trim()?String(e??"").trim()?"":o.signNoInk:o.signerMissing}function nt(e){return e==="dept_head"?o.createSentChef:o.createSent}function it(e){return e?o.editChefReset:o.editSuccess}function X(e,t){return e==="admin"&&t!=="pending"}function st(e,t,a){return X(e,t)?`⚠️ حذف نهائي لإذن صرف (${a??oe(t).label})؟
هذا مستند مالي موقّع — سيُحذف نهائيًا ويُوثّق باسمك في سجل مدير النظام.
هل أنت متأكد؟`:o.deletePendingConfirm}function rt(e,t){return X(e,t)?o.deleteFinalSuccess:o.deletePendingSuccess}function ot(e){const t=Number.isFinite(Number(e))?String(Math.round(Number(e)*100)/100):"0",a=t.includes(".")?t:`${t}.00`;return`${o.approveSuccessPrefix} ${a}`}function Z(e){return e!==null&&typeof e=="object"?String(e.code??""):""}function ct(e){const t=V(e,"");return Z(e)==="DUPLICATE_DISPATCH"||/مكرر|مشابه|DUPLICATE/.test(t)?o.createDuplicate:t||o.createFailed}function lt(e){return Z(e)==="DISPATCH_APPROVE_IN_PROGRESS"?o.approveInProgress:V(e,o.approveFailed)}const g=e=>encodeURIComponent(String(e));async function pt(e){await b("/api/dispatches","POST",e)}const we=D({chefApprovalReset:u([T(),i(),h()]).nullish(),deptChanged:u([T(),i(),h()]).nullish()}).passthrough();async function dt(e,t){return{chefApprovalReset:!!(await Y(we,`/api/warehouse/dispatches/${g(e)}/edit`,"PUT",t)).chefApprovalReset}}async function ut(e,t){const a=String(t??"").trim();if(!a)throw new Error(o.reopenReasonRequired);await b(`/api/warehouse/dispatches/${g(e)}/reopen`,"POST",{reason:a})}async function ht(e){await b(`/api/dispatches/${g(e)}`,"DELETE")}async function gt(e,t){await b(`/api/warehouse/dispatches/${g(e)}/chef-approve`,"POST",{notes:String(t.notes??""),signatureData:String(t.signatureData??""),signerName:String(t.signerName??"")})}async function mt(e,t){await b(`/api/warehouse/dispatches/${g(e)}/chef-reject`,"POST",{reason:String(t.reason??""),signatureData:String(t.signatureData??""),signerName:String(t.signerName??"")})}const Ae=D({totalValue:u([h(),i()]).nullish()}).passthrough();async function ft(e,t){const a=await Y(Ae,`/api/warehouse/dispatches/${g(e)}/approve`,"POST",{approvedItems:t.approvedItems,approveNotes:String(t.approveNotes??""),signatureData:String(t.signatureData??""),signerName:String(t.signerName??"")});return{totalValue:Number(a.totalValue)||0}}async function bt(e,t){await b(`/api/warehouse/dispatches/${g(e)}/reject`,"POST",{reason:String(t.reason??""),signatureData:String(t.signatureData??""),signerName:String(t.signerName??"")})}async function vt(e,t){await b(`/api/warehouse/dispatches/${g(e)}/receive`,"POST",{items:t.items,notes:String(t.notes??""),signatureData:String(t.signatureData??""),signerName:String(t.signerName??"")})}const c=e=>String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),A=e=>{const t=Number(e);return Number.isFinite(t)?t:0},Q=e=>{const t=A(e);return t<=0?"—":t.toLocaleString("en-US",{maximumFractionDigits:3})},P=e=>e.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}),Ne=e=>c(e??"").replace(/\r?\n/g,"<br>"),_=D({itemName:i().nullable().optional(),name:i().nullable().optional(),unit:i().nullable().optional(),qty:u([i(),h()]).nullable().optional(),approvedQty:u([i(),h()]).nullable().optional(),receivedQty:u([i(),h()]).nullable().optional(),avgCost:u([i(),h()]).nullable().optional()}).passthrough(),ee=D({id:u([i(),h()]).transform(String),deptCode:i().nullable().optional(),deptName:i().nullable().optional(),date:i().nullable().optional(),status:i().nullable().optional(),createdBy:i().nullable().optional(),createdAt:i().nullable().optional(),requestNotes:i().nullable().optional(),notes:i().nullable().optional(),items:E(_).nullable().optional(),approvedItems:E(_).nullable().optional(),receivedItems:u([E(_),ce(i(),le())]).nullable().optional(),needsChefApproval:T().nullable().optional(),approveNotes:i().nullable().optional(),requestSignatureData:i().nullable().optional(),chefApprovedBy:i().nullable().optional(),chefApprovedAt:i().nullable().optional(),chefApprovalSignatureData:i().nullable().optional(),chefRejectedBy:i().nullable().optional(),chefRejectedAt:i().nullable().optional(),chefRejectionSignatureData:i().nullable().optional(),warehouseApprovedBy:i().nullable().optional(),warehouseApprovedAt:i().nullable().optional(),warehouseApprovalSignatureData:i().nullable().optional(),approvedBy:i().nullable().optional(),approvedDate:i().nullable().optional(),warehouseRejectedBy:i().nullable().optional(),warehouseRejectedAt:i().nullable().optional(),warehouseRejectionSignatureData:i().nullable().optional(),kitchenReceivedBy:i().nullable().optional(),kitchenReceivedAt:i().nullable().optional(),kitchenReceiptSignatureData:i().nullable().optional()}).passthrough();function ke(e){const t=ee.safeParse(e);return t.success?t.data:{id:String((e??{}).id??"?")}}async function De(e,t){try{return await pe(ee,`/api/dispatches/${encodeURIComponent(e)}`,de(),t?{signal:t}:{})}catch{return null}}const j="شركة مطاعم الشرفة العالمي",Re="AL SHURFA AL ALAMI RESTAURANTS",W="نظام Karim ERP للإدارة المتكاملة",$e={pending:{label:"بانتظار الاعتماد",tone:"amber"},chef_approved:{label:"معتمد من الشيف — بانتظار المخزن",tone:"blue"},approved:{label:"معتمد من المخزن",tone:"teal"},partially_received:{label:"مستلم جزئيًا",tone:"teal"},received:{label:"مستلم كاملًا",tone:"green"},rejected:{label:"مرفوض",tone:"red"}},Ce={amber:{bg:"#3a2e10",ink:"#f6c453",edge:"#f6c453"},blue:{bg:"#10233a",ink:"#7db4f7",edge:"#7db4f7"},green:{bg:"#0e2b1d",ink:"#5fdca0",edge:"#5fdca0"},teal:{bg:"#0d2724",ink:"#e0c56f",edge:"#c8a24a"},red:{bg:"#33100f",ink:"#ff8a80",edge:"#ff8a80"},slate:{bg:"#18202a",ink:"#cbd5e1",edge:"#cbd5e1"}};function Ie(){const e=new Date,t=a=>String(a).padStart(2,"0");return`${e.getFullYear()}-${t(e.getMonth()+1)}-${t(e.getDate())} ${t(e.getHours())}:${t(e.getMinutes())}`}function te(e){return String(e??"").slice(0,10)||"—"}function w(e){const t=String(e??"").trim();if(!t)return"—";const a=new Date(t);if(Number.isNaN(a.getTime()))return t.slice(0,16).replace("T"," ");const n=s=>String(s).padStart(2,"0");return`${a.getFullYear()}-${n(a.getMonth()+1)}-${n(a.getDate())} ${n(a.getHours())}:${n(a.getMinutes())}`}function p(e){return String(e??"").trim()||"—"}function Ee(e){const t=Array.isArray(e.approvedItems)?e.approvedItems:[];return t.length?t:Array.isArray(e.items)?e.items:[]}function Qe(e){return p(e.createdBy)}function y(e,t){const a=String(e??"").trim();return a.startsWith("data:image")?`<img class="sig-ink" src="${c(a)}" alt="توقيع ${c(t)}" />`:""}function Pe(e){const t=[{role:"مُنشئ الطلب",name:Qe(e),at:te(e.createdAt??e.date),ink:y(e.requestSignatureData,"المنشئ")}];return e.chefApprovedBy||e.chefApprovedAt||e.chefApprovalSignatureData?t.push({role:"اعتماد الشيف",name:p(e.chefApprovedBy),at:w(e.chefApprovedAt),ink:y(e.chefApprovalSignatureData,p(e.chefApprovedBy))}):(e.chefRejectedBy||e.chefRejectedAt||e.chefRejectionSignatureData)&&t.push({role:"قرار الشيف — رفض",name:p(e.chefRejectedBy),at:w(e.chefRejectedAt),ink:y(e.chefRejectionSignatureData,p(e.chefRejectedBy))}),e.warehouseApprovedBy||e.approvedBy||e.warehouseApprovedAt||e.approvedDate||e.warehouseApprovalSignatureData?t.push({role:"اعتماد المخزن",name:p(e.warehouseApprovedBy??e.approvedBy),at:w(e.warehouseApprovedAt??e.approvedDate),ink:y(e.warehouseApprovalSignatureData,p(e.warehouseApprovedBy??e.approvedBy))}):(e.warehouseRejectedBy||e.warehouseRejectedAt||e.warehouseRejectionSignatureData)&&t.push({role:"قرار المخزن — رفض",name:p(e.warehouseRejectedBy),at:w(e.warehouseRejectedAt),ink:y(e.warehouseRejectionSignatureData,p(e.warehouseRejectedBy))}),(e.kitchenReceivedBy||e.kitchenReceivedAt||e.kitchenReceiptSignatureData)&&t.push({role:"الاستلام من القسم",name:p(e.kitchenReceivedBy),at:w(e.kitchenReceivedAt),ink:y(e.kitchenReceiptSignatureData,p(e.kitchenReceivedBy))}),t}function H(e,t={}){const a=Ee(e),n=String(e.status??"").trim(),s=$e[n]??{label:n||"—",tone:"slate"},r=Ce[s.tone],d=`DIS-${e.id}`,m=p(e.deptName??e.deptCode??null),x=Ie(),S=(t.currency??"SAR").trim()||"SAR";let N=0,B=!1;const ae=a.map((l,C)=>{const se=p(l.itemName??l.name??null),re=p(l.unit),I=A(l.qty),k=l.approvedQty==null?null:A(l.approvedQty),z=l.receivedQty==null?null:A(l.receivedQty),v=A(l.avgCost);return v>0&&(B=!0,N+=(k??I)*v),`<tr>
            <td class="c-num" dir="ltr">${C+1}</td>
            <td class="c-name">${c(se)}</td>
            <td class="c-unit">${c(re)}</td>
            <td class="c-qty" dir="ltr">${Q(I)}</td>
            <td class="c-qty" dir="ltr">${k==null?"—":Q(k)}</td>
            <td class="c-qty" dir="ltr">${z==null?"—":Q(z)}</td>
            <td class="c-cost" dir="ltr">${v>0?P(v):"—"}</td>
            <td class="c-total" dir="ltr">${v>0?P((k??I)*v):"—"}</td>
        </tr>`}).join(""),ne=B?`<tr class="sheet-totals"><td colspan="6">الإجمالي — ${a.length} صنف</td><td class="c-total" dir="ltr">${P(N)}</td></tr>`:`<tr class="sheet-totals"><td colspan="6">الإجمالي — ${a.length} صنف</td><td class="c-total" dir="ltr">—</td></tr>`,F=Pe(e),ie=F.map((l,C)=>`
        <div class="chain-box">
            <div class="chain-step">
                <span class="chain-role">${c(l.role)}</span>
                <span class="chain-arrow" aria-hidden="true">${C<F.length-1?"←":"◉"}</span>
            </div>
            ${l.ink||'<div class="sig-ink-empty" aria-hidden="true"></div>'}
            <span class="chain-name">${c(l.name)}</span>
            <small class="chain-at" dir="ltr">${c(l.at)}</small>
        </div>`).join('<div class="chain-connector" aria-hidden="true"></div>'),q=[e.requestNotes??e.notes,e.approveNotes].map(l=>String(l??"").trim()).filter(Boolean).map(Ne).join("<br>"),U=String(t.printedBy??"").trim();return`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>إذن صرف ${c(d)} — ${c(j)}</title>
<style>
@page { size: A4 portrait; margin: 11mm 12mm 14mm 12mm; }
* { box-sizing: border-box; }
body {
    margin: 0; padding: 24px 12px 48px; direction: rtl;
    font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    color: #14231f; background: #e9ebe8;
}
.sheet {
    max-width: 830px; margin: auto; background: #fff;
    border: 1px solid #d8d2c2; border-radius: 16px;
    box-shadow: 0 14px 40px rgb(15 32 27 / 0.18);
    padding: 0 0 16px; overflow: hidden;
}
/* ── الشريط الافتتاحي: أسود كربون + ذهبي ── */
.sheet-head {
    display: flex; align-items: center; gap: 18px;
    background: linear-gradient(135deg, #0d0f0b 0%, #131a12 55%, #1c241c 100%);
    border-bottom: 4px solid #c8a24a; padding: 18px 26px;
}
.sheet-logo {
    width: 88px; height: 88px; object-fit: contain; flex: 0 0 auto;
    background: #fff; border: 2px solid #c8a24a; border-radius: 14px;
    padding: 5px; box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
}
.sheet-brand { display: flex; flex-direction: column; gap: 3px; }
.sheet-company-ar { font-size: 21pt; font-weight: 900; color: #f5efdc; letter-spacing: -0.01em; line-height: 1.18; }
.sheet-company-en { font-size: 8pt; font-weight: 800; letter-spacing: 0.22em; color: #c8a24a; text-transform: uppercase; }
.sheet-company-sub { font-size: 7pt; color: rgb(245 239 220 / 0.55); letter-spacing: 0.04em; }
.sheet-ref { margin-inline-start: auto; text-align: end; color: #d9cfa8; font-size: 7.5pt; line-height: 1.75; }
.sheet-ref b { display: block; font-size: 13pt; color: #fff3c4; font-variant-numeric: tabular-nums; letter-spacing: 0.06em; }
/* ── ترويسة المستند ── */
.doc-headline {
    display: flex; align-items: center; justify-content: center; gap: 18px;
    padding: 16px 24px 4px; position: relative;
    border-bottom: 1px solid #e3ded0;
}
.doc-eyebrow { position: absolute; inset-block-start: 10px; inset-inline-start: 28px; font-size: 7pt; letter-spacing: 0.30em; font-weight: 800; color: #8a6b2f; }
.doc-title { margin: 8px 0 0; font-size: 30pt; font-weight: 900; color: #0d0f0b; }
.doc-sub { font-size: 8pt; color: #6b6556; }
.status-stamp {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 6px 18px; border-radius: 999px; font-size: 10.5pt; font-weight: 900;
    background: ${r.bg}; color: ${r.ink}; border: 1.8px solid ${r.edge}; letter-spacing: 0.02em;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.22);
}
/* ── شبكة المعلومات ── */
.meta-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
    padding: 12px 26px 6px;
}
.meta-cell {
    border: 1px solid #e2ddd0; border-inline-start: 4px solid #c8a24a; border-radius: 10px;
    background: #fdfcf8; padding: 8px 12px;
}
.meta-cell small { display: block; font-size: 7pt; font-weight: 800; color: #8a6b2f; letter-spacing: 0.03em; }
.meta-cell b { font-size: 12.5pt; color: #14231f; font-variant-numeric: tabular-nums; }
/* ── الجدول ── */
.items-wrap { padding: 6px 26px 2px; }
table.sheet-items {
    width: 100%; border-collapse: collapse; font-size: 9pt; direction: rtl;
}
.sheet-items thead th {
    background: #0d0f0b; color: #e0c56f; font-size: 8.5pt; font-weight: 800; letter-spacing: 0.04em;
    border: 1px solid #0d0f0b; padding: 6px 8px; text-align: center;
}
.sheet-items td { border: 1px solid #d9d5c8; padding: 5px 8px; text-align: center; font-variant-numeric: tabular-nums; }
.sheet-items td.c-name { text-align: right; font-weight: 700; color: #14231f; }
.sheet-items tbody tr:nth-child(even) td { background: #faf8ee; }
.sheet-items .sheet-totals td {
    background: #0d0f0b !important; color: #fff3c4; font-weight: 900;
    border: 1px solid #0d0f0b; font-size: 9.5pt; padding: 7px 8px; text-align: right;
}
/* ── سلسلة الاعتماد ── */
.chain-section { padding: 10px 26px 4px; }
.chain-title {
    font-size: 9pt; font-weight: 800; letter-spacing: 0.14em; color: #8a6b2f;
    border-bottom: 1px solid #e0d8c3; padding-bottom: 3px; margin-bottom: 8px; text-align: center;
}
.chain { display: flex; gap: 10px; align-items: stretch; }
.chain-box {
    flex: 1; border: 1px solid #e2ddd0; border-top: 3px solid #c8a24a; border-radius: 10px;
    background: #fdfcf8; padding: 8px 6px; display: flex; flex-direction: column; gap: 3px;
    align-items: center; text-align: center; box-shadow: 0 2px 6px rgb(15 23 42 / 0.07);
}
.chain-role { font-size: 8pt; font-weight: 800; color: #4b4433; letter-spacing: 0.04em; }
.chain-arrow { color: #c8a24a; font-size: 12pt; line-height: 1; font-weight: 900; }
.sig-ink { max-height: 46px; max-width: 150px; object-fit: contain; }
.sig-ink-empty { height: 46px; border-bottom: 1.4px dashed #b9b39c; width: 100%; }
.chain-name { font-size: 10pt; font-weight: 800; color: #14231f; }
.chain-at { font-size: 6.5pt; color: #8a8672; }
.chain-connector { flex: 0 0 6px; }
/* ── ملاحظات ── */
.notes-box {
    margin: 10px 26px 0; border: 1px solid #e2ddd0; border-right: 4px solid #c8a24a;
    border-radius: 10px; background: #fdfaf0; padding: 8px 12px; font-size: 9pt; line-height: 1.9;
}
.notes-box b { color: #8a6b2f; font-size: 8pt; letter-spacing: 0.06em; }
/* ── ذيل الورقة ── */
.sheet-foot {
    margin-top: 12px; border-top: 1.6px solid #c8a24a; padding: 8px 26px 0;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    font-size: 6.5pt; color: #6b6556; letter-spacing: 0.02em;
}
.sheet-foot b { color: #14231f; }
@media print {
    body { padding: 0; background: #fff; }
    .sheet { box-shadow: none; border: 0; border-radius: 0; max-width: none; }
    .sheet-head, .sheet-totals td, .sheet-items thead th, .status-stamp {
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
}
@media (max-width: 640px) {
    .sheet-head { flex-wrap: wrap; gap: 10px; }
    .meta-grid { grid-template-columns: repeat(2, 1fr); }
    .chain { flex-wrap: wrap; }
    .chain-box { min-width: calc(50% - 10px); }
}
</style></head><body>
<article class="sheet">
    <header class="sheet-head">
        <img class="sheet-logo" src="${ue}" alt="شعار الشركة" />
        <div class="sheet-brand">
            <div class="sheet-company-ar">${j}</div>
            <div class="sheet-company-en" lang="en" dir="ltr">${Re}</div>
            <div class="sheet-company-sub">${W}</div>
        </div>
        <div class="sheet-ref">
            <small>رقم الوثيقة</small>
            <b dir="ltr">${c(d)}</b>
            <span>طُبعت: <span dir="ltr">${c(x)}</span></span><br>
            <span>${U?`عامل الطباعة: ${c(U)}`:""}</span>
        </div>
    </header>

    <div class="doc-headline">
        <span class="doc-eyebrow" lang="en" dir="ltr">ISSUE AUTHORIZATION</span>
        <div>
            <h1 class="doc-title">إذن صرف</h1>
            <div class="doc-sub">سند صرف مواد من المخزن إلى قسم المطبخ — وثيقة داخلية رسمية</div>
        </div>
        <span class="status-stamp">${c(s.label)}</span>
    </div>

    <div class="meta-grid">
        <div class="meta-cell"><small>رقم الإذن</small><b dir="ltr">${c(e.id)}</b></div>
        <div class="meta-cell"><small>القسم المصروف إليه</small><b>${c(m)}</b></div>
        <div class="meta-cell"><small>تاريخ الطلب</small><b dir="ltr">${c(te(e.date))}</b></div>
        <div class="meta-cell"><small>عدد الأصناف</small><b dir="ltr">${a.length}</b></div>
    </div>

    <div class="items-wrap">
        <table class="sheet-items">
            <thead>
                <tr><th style="width:34px">#</th><th style="text-align:right">الصنف</th><th style="width:70px">الوحدة</th><th style="width:72px">المطلوب</th><th style="width:72px">المعتمد</th><th style="width:72px">المستلم</th><th style="width:88px">متوسط التكلفة ${c(S)}</th><th style="width:104px">قيمة التكلفة</th></tr>
            </thead>
            <tbody>${ae}${ne}</tbody>
        </table>
    </div>

    <section class="chain-section">
        <div class="chain-title"><bdi lang="en">APPROVAL CHAIN</bdi> · سلسلة الاعتماد</div>
        <div class="chain">${ie}</div>
    </section>

    ${q?`<div class="notes-box"><b>ملاحظات</b><br>${q}</div>`:""}

    <footer class="sheet-foot">
        <span><b>${j}</b> — ${W}</span>
        <span>وثيقة رسمية داخلية — لا تُستخدم خارج دورة المخزن</span>
        <span dir="ltr">${c(d)}</span>
    </footer>
</article>
</body></html>`}async function yt(e,t){const a=ke(e);try{const n=await De(a.id)??a;L(H(n,{printedBy:t}),{printDelayMs:350})}catch{L(H(a,{printedBy:t}),{printDelayMs:350})}}export{dt as A,gt as B,mt as C,o as D,ot as E,ft as F,bt as G,vt as H,rt as I,ht as J,ut as K,qe as a,Le as b,Fe as c,Be as d,Me as e,ze as f,Ke as g,Je as h,st as i,Ve as j,Ge as k,He as l,Ye as m,ct as n,at as o,yt as p,Xe as q,We as r,Ze as s,lt as t,et as u,tt as v,Ue as w,nt as x,pt as y,it as z};
