import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ConfirmationPage from './components/ConfirmationPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-nokael-bg selection:bg-nokael-neon selection:text-black">
        <Routes>
          {/* Main Confirmation Route */}
          <Route path="/:token/:step" element={<ConfirmationPage />} />
          
          {/* Default/Fallback */}
          <Route path="*" element={
            <div className="flex flex-col items-center justify-center min-h-[100dvh] p-8 text-center space-y-6">
              <h1 className="text-4xl font-black italic italic tracking-tighter uppercase">NOKAEL</h1>
              <p className="text-[#1a1a2b] border-[#3c0f0f] max-w-xs">Chain of custody system. Please use the unique link provided via WhatsApp.</p>
            </div>
          } />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
