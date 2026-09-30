import Link from 'next/link';
import { ArrowRight, ArrowUpRight, CalendarCheck2, CarFront, Check, Clock3, Download, Headphones, ShieldCheck, Wrench } from 'lucide-react';

const steps = [
  { number: '01', title: 'Tell us about the visit', copy: 'Choose services and your demo vehicle, or describe what you need to the assistant.' },
  { number: '02', title: 'Find a time that fits', copy: 'Add a date and arrival window. See matching options and their full price before choosing.' },
  { number: '03', title: 'Review every detail', copy: 'Check the proposed visit and confirm it yourself. Your plan stays visible throughout.' },
];

export default function Home() {
  return <div className="landing-shell">
    <header className="landing-header">
      <Link className="brand landing-brand" href="/" aria-label="SlotPilot home"><span className="brand-mark"><Wrench size={19}/></span>SlotPilot<span className="brand-sub">SERVICE CONCIERGE</span></Link>
      <nav aria-label="Main navigation"><a href="#how-it-works">How it works</a><Link href="/book">Book a visit</Link></nav>
      <span className="demo-label">DEMO EXPERIENCE</span>
    </header>

    <main className="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-image" aria-hidden="true"/>
        <div className="landing-hero-content">
          <span className="landing-kicker"><span className="landing-kicker-dot"/> A clearer way to plan car care</span>
          <h1 id="landing-title">Your next workshop visit, <em>beautifully sorted.</em></h1>
          <p>Meet a smarter way to explore services, find a time and review every detail. SlotPilot guides you from the first question to a clear plan.</p>
          <div className="landing-hero-actions"><Link className="landing-button landing-button-primary" href="/book#assistant">Plan my visit <ArrowUpRight size={18}/></Link><a className="landing-button landing-button-ghost" href="#how-it-works">See how it works <ArrowRight size={18}/></a><a className="landing-button landing-button-ghost" href="https://github.com/NuraliKuzhagaliev/SlotPilot-app/releases/download/v0.3.2/SlotPilot-0.3.2-Setup-x64.exe" aria-label="Download SlotPilot installer for Windows x64">Download for Windows <Download size={18} aria-hidden="true"/></a></div>
          <div className="landing-hero-proof"><span><Check size={15}/> Clear service options</span><span><Check size={15}/> Times that fit your day</span><span><Check size={15}/> You confirm the plan</span></div>
        </div>
        <div className="landing-image-caption"><span className="landing-caption-line"/> ONE VISIT · ONE TECHNICIAN · ONE BAY</div>
      </section>

      <section className="landing-intro" aria-labelledby="intro-title">
        <div className="landing-intro-heading"><span className="landing-section-label">THE SLOT PILOT EXPERIENCE</span><h2 id="intro-title">A workshop visit that makes sense from the start.</h2></div>
        <p>Car service often begins with uncertain prices and back-and-forth about time. Here, you can shape your visit at your own pace, with the plan and available options on one screen.</p>
      </section>

      <section className="landing-capabilities" aria-label="What you can plan">
        <article className="landing-capability"><span className="landing-capability-icon"><Wrench size={24}/></span><span className="landing-capability-index">01 / SERVICES</span><h3>Care that fits your car.</h3><p>Explore routine maintenance, checks and specialist services from the demo catalogue.</p><span className="landing-capability-detail">UP TO THREE SERVICES <ArrowUpRight size={16}/></span></article>
        <article className="landing-capability"><span className="landing-capability-icon"><Clock3 size={24}/></span><span className="landing-capability-index">02 / SCHEDULING</span><h3>Time back in your day.</h3><p>Set a date and arrival window, then compare workshop times that match your plan.</p><span className="landing-capability-detail">CLEAR ARRIVAL WINDOWS <ArrowUpRight size={16}/></span></article>
        <article className="landing-capability"><span className="landing-capability-icon"><Headphones size={24}/></span><span className="landing-capability-index">03 / GUIDANCE</span><h3>A conversation, if you want one.</h3><p>Speak or type to the assistant while your services, date and time stay visible in the form.</p><span className="landing-capability-detail">VOICE OR TEXT <ArrowUpRight size={16}/></span></article>
      </section>

      <section className="landing-process" id="how-it-works" aria-labelledby="process-title">
        <div className="landing-process-lead"><span className="landing-section-label">SIMPLE BY DESIGN</span><h2 id="process-title">From “what does my car need?” to a visit that works.</h2><p>Every step is visible. You can use the assistant or adjust the form directly.</p><Link href="/book#assistant" className="landing-inline-link">Start planning <ArrowUpRight size={18}/></Link></div>
        <div className="landing-steps">{steps.map(({number,title,copy})=><article className="landing-step" key={number}><span className="landing-step-number">{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div>
      </section>

      <section className="landing-finale" aria-labelledby="finale-title"><div><span className="landing-section-label">READY WHEN YOU ARE</span><h2 id="finale-title">Make room for a better service experience.</h2><p>Choose a service, find a time and see the full plan before you decide.</p></div><Link className="landing-button landing-button-primary" href="/book#assistant">Book a demo visit <ArrowUpRight size={18}/></Link></section>
      <div className="landing-disclosure"><div><CarFront size={18}/> SlotPilot is a demo workshop experience. Services, availability and prices are example data.</div><div><CalendarCheck2 size={18}/> You review the proposed visit before confirming.</div><div><ShieldCheck size={18}/> Your booking actions require explicit confirmation.</div></div>
    </main>
    <footer className="landing-footer"><Link className="brand" href="/"><span className="brand-mark"><Wrench size={17}/></span>SlotPilot</Link><span>Thoughtful car service booking, from first question to final choice.</span><span>Demo services · Asia/Almaty</span></footer>
  </div>;
}
