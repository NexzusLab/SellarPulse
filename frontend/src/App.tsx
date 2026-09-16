import React from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
import WalletConnect from './components/WalletConnect';
import EmployerDashboard from './pages/EmployerDashboard';
import EmployeeDashboard from './pages/EmployeeDashboard';

function Layout({ children }: { children: React.ReactNode }) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
      isActive ? 'bg-white/10 text-white' : 'text-stellar-200 hover:text-white'
    }`;

  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-ink px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stellar-500 text-lg font-extrabold text-white">
            ◎
          </span>
          <span className="text-lg font-extrabold tracking-tight text-white">
            Stellar<span className="text-stellar-400">Pulse</span>
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <NavLink to="/employer" className={linkClass}>
            Employer
          </NavLink>
          <NavLink to="/employee" className={linkClass}>
            Employee
          </NavLink>
          <div className="ml-3">
            <WalletConnect />
          </div>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Layout>
              <Landing />
            </Layout>
          }
        />
        <Route
          path="/employer"
          element={
            <Layout>
              <EmployerDashboard />
            </Layout>
          }
        />
        <Route
          path="/employee"
          element={
            <Layout>
              <EmployeeDashboard />
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

function Landing() {
  return (
    <div className="relative overflow-hidden">
      <div className="mx-auto max-w-4xl px-6 pb-24 pt-20 text-center">
        <p className="mx-auto mb-6 inline-block rounded-full bg-stellar-50 px-3 py-1 text-xs font-semibold text-stellar-600">
          Built on Soroban · Stellar Testnet · Groth16 ZK proofs
        </p>
        <h1 className="text-5xl font-extrabold leading-tight text-stellar-950">
          Global payrolls that prove{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-stellar-600 to-stellar-400">
            solvency
          </span>{' '}
          — without leaking salaries.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-stellar-500">
          StellarPulse runs cross-border payroll on Stellar’s USDC rails, backed by
          zero-knowledge proofs that each batch is fully funded — all while keeping
          individual compensation private.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link
            to="/employer"
            className="rounded-xl bg-stellar-600 px-6 py-3 text-sm font-semibold text-white hover:bg-stellar-700 transition-colors"
          >
            Run a payroll →
          </Link>
          <Link
            to="/employee"
            className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-stellar-700 shadow-card hover:bg-stellar-50 transition-colors"
          >
            I’m an employee
          </Link>
        </div>
      </div>
    </div>
  );
}