/* Small public UX layer; uses the existing map and report flows. */
(() => {
  const $=id=>document.getElementById(id);
  $('reportConnection').after($('helpNotice'));
  let lastSync='', toastTimer;
  window.showUXToast=message=>{ $('uxToast').textContent=message; $('uxToast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('uxToast').hidden=true,6500); };
  const syncStatus=()=>{
    $('connectionDot').classList.toggle('online',apiOnline);
    $('publicStatus').textContent=apiOnline ? `เชื่อมต่อแล้ว${lastSync?' · โหลดล่าสุด '+lastSync:''}` : 'เชื่อมระบบรายงานไม่ได้';
    const total=['floodCount','helpCount','otherCount'].reduce((sum,id)=>sum+Number($(id).textContent||0),0);
    $('publicSummary').textContent=total ? `รายงานตามตัวกรอง ${total} จุด · แตะบนแผนที่เพื่ออ่านรายละเอียด` : 'ยังไม่มีรายงานตามตัวกรองที่เลือก';
    $('reportConnection').textContent=apiOnline?'รายงานที่ส่งจะแสดงให้คนอื่นเห็นบนแผนที่':'ขณะนี้ระบบกลางยังไม่พร้อม จึงยังส่งรายงานไม่ได้';
  };
  const oldRefresh=refreshReportsFromBackend;
  refreshReportsFromBackend=async()=>{await oldRefresh();if(apiOnline)lastSync=new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});syncStatus();};
  new MutationObserver(syncStatus).observe($('reportStoreStatus'),{childList:true,subtree:true,characterData:true});
  new MutationObserver(syncStatus).observe(document.querySelector('.stats'),{childList:true,subtree:true,characterData:true});
  $('refreshPublic').onclick=async()=>{const b=$('refreshPublic');b.disabled=true;b.textContent='กำลังโหลด…';try{await refreshReportsFromBackend();}finally{b.disabled=false;b.textContent='↻ โหลดใหม่';}};
  window.prepareReportUX=()=>{
    syncStatus();
    const grid=$('typeGrid');
    const extras=[...grid.querySelectorAll('.emg-type')].filter(el=>!['flood','help_request',selectedType].includes(el.querySelector('input').value));
    extras.forEach(el=>el.hidden=true);
    $('moreTypes')?.remove();
    const button=document.createElement('button');button.id='moreTypes';button.type='button';button.className='more-types';button.textContent='แจ้งเรื่องอื่น เช่น ถนนปิด / จุดพักพิง';button.setAttribute('aria-expanded','false');
    button.onclick=()=>{const open=button.getAttribute('aria-expanded')!=='true';extras.forEach(el=>el.hidden=!open);button.setAttribute('aria-expanded',String(open));button.textContent=open?'แสดงตัวเลือกน้อยลง':'แจ้งเรื่องอื่น เช่น ถนนปิด / จุดพักพิง';};grid.after(button);
    $('reportDialog').scrollTop=0;
  };
  $('publicFlood').onclick=()=>openReport('flood');
  $('publicHelp').onclick=()=>openReport('help_request');
  // v0.11: province selector removed. Map scope follows the Mae Klong basin study envelope.
  const panel=$('panel');
  panel.append($('mobileAdminBtn'));
  const mobile=()=>matchMedia('(max-width:760px)').matches;
  const syncDrawer=()=>{const open=document.body.classList.contains('mobile-menu-open');panel.inert=mobile()&&!open;if(mobile()){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');}else{panel.removeAttribute('role');panel.removeAttribute('aria-modal');}if(open)$('panelClose').focus();};
  new MutationObserver(syncDrawer).observe(document.body,{attributes:true,attributeFilter:['class']});
  addEventListener('resize',syncDrawer);
  panel.addEventListener('keydown',e=>{if(e.key!=='Tab'||!mobile())return;const elements=[...panel.querySelectorAll('button,input,select,a[href]')].filter(el=>el.getClientRects().length&&!el.disabled);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}});
  $('panelClose').addEventListener('click',()=>$('menuBtn').focus());
  document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.mode').forEach(x=>x.setAttribute('aria-pressed',String(x.dataset.mode===currentMode)));}));
  new MutationObserver(()=>{document.body.classList.toggle('picking-location',!$('mapPickBar').hidden);document.querySelector('.public-actions').inert=!$('mapPickBar').hidden;}).observe($('mapPickBar'),{attributes:true,attributeFilter:['hidden']});
  syncStatus();syncDrawer();
})();
