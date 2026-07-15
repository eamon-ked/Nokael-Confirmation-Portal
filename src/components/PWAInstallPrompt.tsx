import { useState, useEffect } from 'react';
import { Download, Share, PlusSquare, X, Smartphone, ExternalLink } from 'lucide-react';
import { isWhatsAppBrowser } from '@/src/lib/utils';

export default function PWAInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // 1. Check if already installed / running in standalone mode
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    setIsStandalone(standalone);

    // 2. Check if user dismissed it recently
    const isDismissed = localStorage.getItem('nokael_pwa_dismissed') === 'true';

    // 3. Detect iOS Safari
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    // If already standalone or dismissed, don't show
    if (standalone || isDismissed) {
      return;
    }

    // 4. Check for stored deferred prompt or listen for event
    if ((window as any).deferredPWAInstallPrompt) {
      setDeferredPrompt((window as any).deferredPWAInstallPrompt);
      setShowPrompt(true);
    } else {
      const handlePromptReady = () => {
        setDeferredPrompt((window as any).deferredPWAInstallPrompt);
        setShowPrompt(true);
      };

      window.addEventListener('nokael_pwa_prompt_ready', handlePromptReady);
      
      // Also fallback/general listener in case the event triggers right now
      const handleBeforeInstall = (e: Event) => {
        e.preventDefault();
        (window as any).deferredPWAInstallPrompt = e;
        setDeferredPrompt(e);
        setShowPrompt(true);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstall);

      // On iOS or WhatsApp, we can show instructions even without beforeinstallprompt
      if (ios || isWhatsAppBrowser()) {
        setShowPrompt(true);
      }

      return () => {
        window.removeEventListener('nokael_pwa_prompt_ready', handlePromptReady);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    // Show the browser install prompt
    deferredPrompt.prompt();

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`[PWA] User response to install prompt: ${outcome}`);

    // Clear the deferred prompt variable
    (window as any).deferredPWAInstallPrompt = null;
    setDeferredPrompt(null);
    setShowPrompt(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('nokael_pwa_dismissed', 'true');
    setShowPrompt(false);
  };

  if (!showPrompt || isStandalone) {
    return null;
  }

  // Determine what type of prompt/instruction to show
  const insideWhatsApp = isWhatsAppBrowser();

  return (
    <div className="mx-auto max-w-sm px-1 mb-2">
      <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl p-4 shadow-xl relative overflow-hidden animate-fade-in">
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-slate-400 hover:text-white p-1 rounded-full hover:bg-slate-800 transition-all"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-nokael-primary/10 border border-slate-700 rounded-xl flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h3 className="text-[15px] font-semibold text-white tracking-tight">Install Nokael Driver App</h3>
            <p className="text-slate-400 text-[12px] mt-0.5 leading-relaxed">
              Add to home screen for fast, reliable access to your jobs, offline capability, and instant push-like responsiveness.
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-800 pt-3.5">
          {insideWhatsApp ? (
            // WhatsApp Webview warning
            <div className="space-y-2.5">
              <div className="bg-amber-950/40 border border-amber-900/50 rounded-xl p-3 text-[12px] text-amber-200 leading-normal flex items-start gap-2">
                <span className="text-[14px]">⚠️</span>
                <span>
                  <strong>WhatsApp In-App Browser detected.</strong> To install the app, you need to open it in your default system browser first.
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-300 text-[12px] font-medium px-1">
                <span>Tap the menu button at the top right (<b>⋮</b> or <b>···</b>) and choose <strong>"Open in Chrome"</strong> or <strong>"Open in Safari"</strong>.</span>
              </div>
            </div>
          ) : isIOS ? (
            // iOS Safari instructions
            <div className="space-y-3">
              <p className="text-slate-300 text-[12px] leading-normal font-medium">
                Install on your iPhone or iPad:
              </p>
              <div className="bg-slate-800/60 rounded-xl p-3 space-y-2 text-[12px] text-slate-200">
                <div className="flex items-center gap-2.5">
                  <div className="w-5 h-5 bg-slate-700 rounded flex items-center justify-center shrink-0">
                    <Share className="w-3 h-3 text-slate-200" />
                  </div>
                  <span>1. Tap the <strong>Share</strong> button in the browser toolbar</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-5 h-5 bg-slate-700 rounded flex items-center justify-center shrink-0">
                    <PlusSquare className="w-3.5 h-3.5 text-slate-200" />
                  </div>
                  <span>2. Scroll down and select <strong>"Add to Home Screen"</strong></span>
                </div>
              </div>
            </div>
          ) : deferredPrompt ? (
            // Android / Chrome direct install
            <button
              onClick={handleInstallClick}
              className="w-full bg-white text-slate-950 hover:bg-slate-100 active:scale-[0.98] transition-all font-semibold text-[13px] py-2.5 px-4 rounded-xl flex items-center justify-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Install Now</span>
            </button>
          ) : (
            // Fallback instruction for other browsers (e.g. desktop safari/firefox)
            <div className="text-[12px] text-slate-300 space-y-1 bg-slate-800/40 p-2.5 rounded-xl">
              <p className="font-medium">How to install:</p>
              <p>Open your browser menu (usually three dots or share menu) and select <strong>"Add to Home Screen"</strong> or <strong>"Install App"</strong>.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
