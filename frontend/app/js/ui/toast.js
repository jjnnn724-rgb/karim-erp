/**
 * ui/toast.js — toast + loading overlay helpers (extracted verbatim from app.js — EXTRACTION-004)
 * Bridge policy: mounted on window by js/main.js (BRIDGE-004). realtime.js consumes window.toast (11 refs).
 * External dependency: enhancedToast() — top-level declaration in app.js (classic auto-global), resolved
 * from window at call time. esc() — BRIDGE-003.
 */
function toast(msg,type='success'){ try{ enhancedToast(esc(msg),type); }catch(e){} }
function showLoad(){ const l=document.getElementById('loading'); if(l) {l.classList.add('show');} }
function hideLoad(){ const l=document.getElementById('loading'); if(l) {l.classList.remove('show');} }

export { toast, showLoad, hideLoad };
