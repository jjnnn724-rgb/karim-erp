/**
 * EmployeeCard.jsx — بطاقة موظف فاخرة ID-1 (React)
 * Props: { employee: { nameAr, nameEn, position, dept, empNo, photo, qr }, logo }
 * الوجهان + طباعة. الألوان: كحلي #0A2540 / ذهبي #C9A961.
 */
import React from 'react';
import './card.css';

export function CardFront({ employee, logo, qr, guillocheSvg }) {
  const e = employee || {};
  return (
    <div className="idcard" dir="rtl">
      <div className="guilloche" dangerouslySetInnerHTML={{ __html: guillocheSvg }} />
      <div className="topband">
        <img className="logo" src={logo} alt="logo" />
        <div className="co">مطاعم الشرفه العالمي<small>AL SHORFA RESTAURANTS</small></div>
      </div>
      <div className="holo" />
      <div className="front-body">
        <img className="photo" src={e.photo} alt={e.nameAr} />
        <div className="front-info">
          <div><div className="field-label">الاسم</div><div className="field-val-ar">{e.nameAr}</div></div>
          <div className="field-val-en">{e.nameEn}</div>
          <div><div className="field-label">المسمى الوظيفي • القسم</div>
            <div style={{ fontSize: '2.9mm', fontWeight: 700 }}>{e.position} • {e.dept}</div></div>
          <div><div className="field-label">رقم الموظف</div><div className="emp-no">{e.empNo}</div></div>
        </div>
        <div className="front-side">
          <div className="chip" />
          <div className="qrbox"><img src={qr} alt="qr" /></div>
        </div>
      </div>
      <div className="micro"><span>{e.microtext}</span></div>
    </div>
  );
}

export function CardBack({ logo, mrz, barsHtml, terms, emergency, issue, expiry, microtext }) {
  return (
    <div className="idcard" dir="rtl">
      <div className="topband" style={{ height: '7mm' }}>
        <img className="logo" src={logo} alt="logo" />
        <div className="co" style={{ fontSize: '2.8mm' }}>بطاقة موظف — EMPLOYEE CARD</div>
      </div>
      <div className="holo" />
      <div className="back-body" style={{ top: '9mm' }}>
        <div className="mrz">{mrz[0]}<br />{mrz[1]}<br />{mrz[2]}</div>
        <div className="barcode" dangerouslySetInnerHTML={{ __html: barsHtml }} />
        <div className="terms">{terms}</div>
        <div><span className="emg">Emergency: {emergency}</span>
          <span style={{ fontSize: '2.1mm', color: '#475569' }}>إصدار {issue} • انتهاء {expiry}</span></div>
      </div>
      <div className="micro"><span>{microtext}</span></div>
    </div>
  );
}

export default function EmployeeCard({ employee, logo, qr, guillocheSvg, mrz, barsHtml, terms, emergency, issue, expiry }) {
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <CardFront employee={employee} logo={logo} qr={qr} guillocheSvg={guillocheSvg} />
      <CardBack logo={logo} mrz={mrz} barsHtml={barsHtml} terms={terms} emergency={emergency} issue={issue} expiry={expiry} microtext={employee?.microtext} />
    </div>
  );
}
