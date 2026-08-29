'use client';

import React from 'react';

interface TourStep {
  selector: string;
  title: string;
  description: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    selector: '#co-quick-actions',
    title: '1. Importez vos données',
    description: 'Scannez une fiche de débit avec la caméra, ou ajoutez les pièces manuellement.',
  },
  {
    selector: '#co-pieces-manager',
    title: '2. Gérez vos pièces',
    description: 'Ajoutez, modifiez ou supprimez les pièces. Indiquez la hauteur, largeur et quantité.',
  },
  {
    selector: '#co-optimize-btn',
    title: '3. Lancez l\'optimisation',
    description: 'Cliquez sur Optimiser pour calculer le placement optimal. Ajustez les options avancées.',
  },
  {
    selector: '#co-export-section',
    title: '4. Exportez votre plan',
    description: 'Téléchargez le rapport PDF, DXF pour CNC, PNG ou JSON. Visualisez le coût estimé.',
  },
];

export function OnboardingTour() {
  const startTour = () => {
    // Inject driver.js dynamically
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.js.iife.js';
    script.onload = () => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdn.jsdelivr.net/npm/driver.js@1.3.1/dist/driver.css';
      document.head.appendChild(css);

      const dwindow = window as unknown as Record<string, unknown>;
      const driverObj = (dwindow.driver as (...args: unknown[]) => { drive: () => void })({
        animate: true,
        showProgress: true,
        showButtons: ['next', 'previous', 'close'],
        steps: TOUR_STEPS.map(s => ({
          element: s.selector || undefined,
          popover: {
            title: s.title,
            description: s.description,
            side: 'bottom',
            align: 'start',
          },
        })),
        onDestroyed: () => localStorage.setItem('qatlia-tour-done', '1'),
      });
      driverObj.drive();
    };
    document.head.appendChild(script);
  };

  return (
    <button
      onClick={startTour}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-brand-400 hover:bg-brand-500/20 text-[11px] font-semibold transition-all"
      title="Visite guidée"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      Guide
    </button>
  );
}