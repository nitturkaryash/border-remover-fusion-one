import React, { useEffect } from 'react';
import { BatchProcessorLayout } from '@/components/organisms/BatchProcessorLayout';
import { Toaster } from '@/components/ui/toaster';

const App: React.FC = () => {
  useEffect(() => {
    console.log('App component mounted');
    console.log('electronAPI available:', !!window.electronAPI);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 py-10">
        <BatchProcessorLayout />
      </main>
      <Toaster />
    </div>
  );
};

export default App; 