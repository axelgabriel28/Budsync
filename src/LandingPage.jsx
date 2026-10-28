import { useEffect, useState } from 'react'
import { Sun, Moon } from 'lucide-react'
import './LandingPage.css'

const root = import.meta.env.BASE_URL
const features = [
  { number: '01', title: 'Organize', description: 'Keep organization, personal, savings, and digital wallets distinct while seeing the whole picture.' },
  { number: '02', title: 'Track', description: 'Record income, expenses, transfers, budgets, and supporting receipts in one clear workspace.' },
  { number: '03', title: 'Sync', description: 'Save on your device first, then synchronize account records and connected receipts when online.' },
]
const wallets = ['Personal', 'Organization', 'Savings', 'E-Wallet']

function Logo() {
  return <span className="landing-brand"><img src={`${root}budsync-logo-black.png`} alt="Budsync" /></span>
}

function DashboardPreview() {
  return <div className="landing-preview" aria-label="Illustrative Budsync dashboard preview">
    <div className="preview-desktop">
      <div className="preview-sidebar"><Logo /><span className="preview-nav active">Overview</span><span className="preview-nav">Transactions</span><span className="preview-nav">Wallets</span><span className="preview-nav">Receipts</span><span className="preview-nav">Insights</span></div>
      <div className="preview-content"><div className="preview-topline"><span>FINANCIAL OVERVIEW</span><span>● Saved on this device</span></div><h3>Your workspace, at a glance.</h3><div className="preview-balance"><small>TOTAL BALANCE</small><strong>₱ —</strong><span>Calculated from opening balances and recorded activity</span></div><div className="preview-metrics"><div><small>INCOME THIS MONTH</small><strong>₱ —</strong></div><div><small>EXPENSES THIS MONTH</small><strong>₱ —</strong></div></div><div className="preview-lower"><div><small>MONTHLY CASH FLOW</small><div className="preview-chart" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div></div><div><small>RECENT ACTIVITY</small><p>No transactions yet</p><p>Entries appear here as they are recorded.</p></div></div></div>
    </div>
    <div className="preview-phone" aria-hidden="true"><div className="preview-phone-top">Budsync <span>●</span></div><small>TOTAL BALANCE</small><strong>₱ —</strong><div className="preview-phone-card">Income <span>₱ —</span></div><div className="preview-phone-card">Expenses <span>₱ —</span></div><div className="preview-phone-bar">Overview　 Wallets　＋　Receipts</div></div>
    <p className="preview-caption">Illustrative interface preview. No sample activity is shown.</p>
  </div>
}

export default function LandingPage() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('budsync-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' } })
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('budsync-theme', theme) } catch { /* Theme stays active for this visit. */ } }, [theme])
  return <div className="landing">
    <a className="landing-skip" href="#landing-main">Skip to content</a>
    <header className="landing-header"><nav className="landing-nav" aria-label="Main navigation"><a href="/welcome" aria-label="Budsync home"><Logo /></a><div className="landing-links"><a href="#features">Features</a><a href="#security">Security</a><a href="#pricing">Pricing</a><a href="#about">About</a></div><div className="landing-nav-actions"><button type="button" className="landing-theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={19} strokeWidth={1.9} aria-hidden="true" /> : <Moon size={19} strokeWidth={1.9} aria-hidden="true" />}</button><a className="landing-signin" href="/?page=account">Sign In</a><a className="landing-button landing-button-dark" href="/">Get Started <span aria-hidden="true">↗</span></a></div></nav></header>
    <main id="landing-main">
      <section className="landing-hero"><div className="landing-hero-copy"><span className="landing-eyebrow">YOUR FINANCES, IN SYNC</span><h1>Track. Plan.<br /><em>Sync.</em> Together.</h1><p>A simple and powerful finance application for individuals and organizations. Manage budgets, track expenses, organize multiple wallets, and stay in sync with what matters.</p><div className="landing-actions"><a className="landing-button landing-button-dark" href="/">Get Started <span aria-hidden="true">↗</span></a><a className="landing-button landing-button-outline" href="#features">Explore Features <span aria-hidden="true">↓</span></a></div><div className="landing-hero-note"><span>01 / 03</span><span>Clarity for every financial decision</span></div></div><DashboardPreview /></section>
      <section id="features" className="landing-section"><div className="landing-section-head"><span className="landing-eyebrow">WHAT BUDSYNC DOES</span><h2>Every record in its place.</h2><p>Organize money movement and the documents behind it in one practical workspace.</p></div><div className="landing-feature-grid">{features.map((feature) => <article className="landing-feature" key={feature.number}><span>{feature.number} / 03</span><div className="landing-feature-symbol" aria-hidden="true">{feature.number === '01' ? '◫' : feature.number === '02' ? '↗' : '⇄'}</div><h3>{feature.title}</h3><p>{feature.description}</p></article>)}</div></section>
      <section id="about" className="landing-section landing-split"><div><span className="landing-eyebrow">BUILT FOR THE WAY YOU WORK</span><h2>One view. Multiple wallets.</h2><p>See each fund on its own terms and understand how recorded activity affects the combined balance. Transfers between wallets keep the total intact.</p><a className="landing-text-link" href="/">Open your workspace <span aria-hidden="true">↗</span></a></div><div className="landing-wallets">{wallets.map((wallet, index) => <div className="landing-wallet" key={wallet}><span className="landing-wallet-icon" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{wallet}</strong><span>₱ —</span></div>)}<small>Illustrative wallet view. Balances come from your own records.</small></div></section>
      <section id="security" className="landing-section landing-security"><span className="landing-eyebrow">DATA YOU CAN UNDERSTAND</span><h2>Clear records. Clear sync state.</h2><div><p>Budsync saves records on your device first. Optional account sync keeps wallet records available across devices, while connected Google Drive stores receipt images separately.</p><p>The app shows whether an image is local, waiting for Drive, or uploaded. Your wallet backup does not include receipt images.</p></div></section>
      <section id="pricing" className="landing-pricing"><div><span className="landing-eyebrow">PRICING</span><h2>Built in the open.</h2><p>Budsync is in development. Public pricing has not been announced.</p></div><a className="landing-button landing-button-outline" href="/">Explore Budsync <span aria-hidden="true">↗</span></a></section>
      <section className="landing-cta"><span className="landing-eyebrow">A CLEARER WAY FORWARD</span><h2>Stay in Sync<br />With What Matters.</h2><p>Take control of every financial decision with a simpler, smarter way to manage your money.</p><a className="landing-button landing-button-light" href="/">Start With Budsync <span aria-hidden="true">↗</span></a></section>
    </main>
    <footer className="landing-footer"><Logo /><p>Financial records, thoughtfully organized.</p><div><a href="#features">Features</a><a href="#security">Security</a><a href="#pricing">Pricing</a><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></div><small>© {new Date().getFullYear()} Budsync</small></footer>
  </div>
}
