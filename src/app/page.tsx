'use client';

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, Wifi, WifiOff, Loader2, Settings2 } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
// Server Action (sendTraccarData) is now called by the API route, not directly by the page or SW for sending data.
// However, we might keep it if there are other direct actions. For now, it's not directly used by page for sending.

const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055';

const TraccarWebClient: NextPage = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10);
  const [isUiDisabled, setIsUiDisabled] = useState<boolean>(false); // For when SW is controlling
  const [isServiceWorkerActive, setIsServiceWorkerActive] = useState<boolean>(false);
  const [isSwTracking, setIsSwTracking] = useState<boolean>(false); // Reflects SW's tracking state
  const [statusMessage, setStatusMessage] = useState<string>('Serviço parado.');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const { toast } = useToast();

  const isMountedRef = useRef(false);


  // Function to send command and config to Service Worker
  const sendCommandToSW = useCallback((command: string, data?: any) => {
    if (serviceWorkerRef.current && serviceWorkerRef.current.active) {
      serviceWorkerRef.current.active.postMessage({ command, data });
    } else {
      // console.warn("Service Worker não está ativo. Comando não enviado:", command);
      toast({ title: "Service Worker Inativo", description: "Não foi possível comunicar com o serviço de segundo plano.", variant: "destructive"});
    }
  }, [toast]);

  // Effect for Service Worker registration and message handling
  useEffect(() => {
    isMountedRef.current = true;
    if ('serviceWorker' in navigator) {
      const swFile = '/traccar-service-worker.js';
      navigator.serviceWorker.register(swFile)
        .then(registration => {
          // console.log('Service Worker registrado com escopo:', registration.scope);
          serviceWorkerRef.current = registration;
          setIsServiceWorkerActive(true);
          setStatusMessage('Serviço de segundo plano pronto.');
          toast({ title: "Serviço Ativado", description: "Rastreamento em segundo plano está pronto." });
          
          // Ask SW for its current status
          if (isMountedRef.current) sendCommandToSW('get-status');

          // Listen for messages from the Service Worker
          navigator.serviceWorker.onmessage = (event) => {
            if (!isMountedRef.current) return;
            const { type, message, isTracking: swIsTracking } = event.data;
            if (type === 'status') {
              setStatusMessage(message);
            } else if (type === 'error') {
              setErrorMessage(message);
              setStatusMessage("Erro no serviço.");
              // toast({ title: "Erro no Serviço", description: message, variant: "destructive" });
            } else if (type === 'success') {
              setStatusMessage(`[SW] ${message} (${new Date().toLocaleTimeString()})`);
              setErrorMessage(null);
              toast({ title: "Sucesso", description: message });
            } else if (type === 'tracking_status') {
              setIsSwTracking(swIsTracking);
              setStatusMessage(message || (swIsTracking ? "Rastreamento ativo em segundo plano." : "Rastreamento parado em segundo plano."));
              if (swIsTracking) setErrorMessage(null); // Clear error if tracking starts successfully
            }
          };
        })
        .catch(error => {
          console.error('Falha ao registrar Service Worker:', error);
          setErrorMessage("Falha ao iniciar serviço de segundo plano. Funcionalidade de fundo pode não funcionar.");
          toast({ title: "Erro de Serviço", description: "Não foi possível registrar o serviço de segundo plano.", variant: "destructive" });
        });
    } else {
      setErrorMessage("Service Workers não são suportados neste navegador. Rastreamento em segundo plano desabilitado.");
      toast({ title: "Navegador Incompatível", description: "Rastreamento em segundo plano não é suportado.", variant: "destructive" });
    }
    return () => {
        isMountedRef.current = false;
        // Optional: unregister SW or tell it to stop if page is closing.
        // However, SW is designed to persist.
        // if (serviceWorkerRef.current && serviceWorkerRef.current.active) {
        //   sendCommandToSW('stop-tracking'); // Example: stop tracking if user closes the tab
        // }
         if (navigator.serviceWorker) {
            navigator.serviceWorker.onmessage = null; // Clean up message handler
        }
    };
  }, [sendCommandToSW, toast]); // Added sendCommandToSW

  // Load settings from localStorage
  useEffect(() => {
    try {
      const savedDeviceId = localStorage.getItem('traccarDeviceId');
      const savedServerUrl = localStorage.getItem('traccarServerUrl');
      const savedInterval = localStorage.getItem('traccarIntervalSeconds');

      if (savedDeviceId) setDeviceId(savedDeviceId);
      
      let urlToSet = DEFAULT_SERVER_URL;
      if (savedServerUrl) {
        try { new URL(savedServerUrl); if (savedServerUrl.trim() !== '') urlToSet = savedServerUrl; } 
        catch (e) { console.warn("URL salva inválida, usando padrão:", savedServerUrl); localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); }
      } else { localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); }
      setServerUrl(urlToSet);

      if (savedInterval) {
        const parsedInterval = parseInt(savedInterval, 10);
        if (!isNaN(parsedInterval) && parsedInterval >= 1 && Number.isInteger(parsedInterval)) setIntervalSeconds(parsedInterval);
        else { setIntervalSeconds(10); localStorage.setItem('traccarIntervalSeconds', '10'); }
      }
    } catch (error) {
      console.error("Erro ao acessar localStorage:", error);
      setErrorMessage("Não foi possível carregar configurações salvas.");
      toast({ title: "Erro de Configuração", description: "Não foi possível ler as configurações salvas.", variant: "destructive" });
    }
  }, [toast]);

  // Save settings to localStorage
  useEffect(() => { if (deviceId.trim() !== '') localStorage.setItem('traccarDeviceId', deviceId); else localStorage.removeItem('traccarDeviceId'); }, [deviceId]);
  useEffect(() => { try { if (serverUrl && serverUrl.trim() !== '') { new URL(serverUrl); localStorage.setItem('traccarServerUrl', serverUrl); } } catch (e) { /* console.warn("Tentativa de salvar URL inválida:", serverUrl); */ } }, [serverUrl]);
  useEffect(() => { if (!isNaN(intervalSeconds) && intervalSeconds >= 1 && Number.isInteger(intervalSeconds)) localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString()); }, [intervalSeconds]);


  const requestLocationPermission = async () => {
    if (!('geolocation' in navigator)) {
      setErrorMessage("Geolocalização não é suportada.");
      toast({ title: "GPS Não Suportado", description: "Seu navegador não suporta geolocalização.", variant: "destructive" });
      return false;
    }
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
      if (permissionStatus.state === 'granted') {
        return true;
      } else if (permissionStatus.state === 'prompt') {
        // Try to trigger the prompt by requesting location once.
        // This is a bit of a hack; ideally, the prompt is more gracefully handled.
        return new Promise<boolean>((resolve) => {
            navigator.geolocation.getCurrentPosition(
                () => {
                    toast({title: "Permissão Concedida", description: "Permissão de localização obtida."});
                    resolve(true);
                },
                (error) => {
                    setErrorMessage("Permissão de localização negada ou erro ao solicitar.");
                    toast({ title: "Permissão Necessária", description: "A permissão de localização é necessária para o rastreamento.", variant: "destructive" });
                    resolve(false);
                },
                { timeout: 5000 } // Short timeout, just to trigger prompt
            );
        });
      } else { // denied
        setErrorMessage("Permissão de localização foi negada. Habilite nas configurações do navegador.");
        toast({ title: "Permissão Negada", description: "Habilite a localização nas configurações do site/navegador.", variant: "destructive" });
        return false;
      }
    } catch (error) {
      console.error("Erro ao verificar/solicitar permissão de localização:", error);
      setErrorMessage("Erro ao verificar permissão de localização.");
      toast({ title: "Erro de Permissão", description: "Não foi possível verificar a permissão de localização.", variant: "destructive" });
      return false;
    }
  };


  const handleStartTracking = async () => {
    // Validations
    if (!deviceId || deviceId.trim() === '') {
      setErrorMessage("Configure o ID do Dispositivo."); toast({ title: "Configuração Incompleta", description: "Insira um ID do Dispositivo.", variant: "destructive" }); return;
    }
    if (!serverUrl || serverUrl.trim() === '') {
      setErrorMessage("Configure a URL do Servidor."); toast({ title: "Configuração Incompleta", description: "Insira a URL do servidor.", variant: "destructive" }); return;
    }
    try { new URL(serverUrl); } catch (_) {
      setErrorMessage(`URL do Servidor inválida: ${serverUrl}.`); toast({ title: "URL Inválida", description: "Insira uma URL de servidor válida.", variant: "destructive" }); return;
    }
    if (isNaN(intervalSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
      setErrorMessage("Intervalo inválido."); toast({ title: "Intervalo Inválido", description: "Insira um intervalo válido.", variant: "destructive" }); return;
    }
    if (!isServiceWorkerActive) {
      setErrorMessage("Serviço de segundo plano não está ativo. Tente recarregar."); toast({ title: "Serviço Inativo", description: "O serviço de segundo plano não iniciou.", variant: "destructive" }); return;
    }

    const permissionGranted = await requestLocationPermission();
    if (!permissionGranted) {
        // Error message already set by requestLocationPermission
        return;
    }

    setStatusMessage("Iniciando rastreamento em segundo plano...");
    setErrorMessage(null);
    sendCommandToSW('start-tracking', { deviceId, serverUrl, intervalSeconds });
    // setIsUiDisabled(true); // Disable UI while SW is tracking (optional)
  };

  const handleStopTracking = () => {
    setStatusMessage("Parando rastreamento em segundo plano...");
    sendCommandToSW('stop-tracking');
    // setIsUiDisabled(false); // Re-enable UI
    toast({ title: "Rastreamento Parado", description: "O serviço de segundo plano foi instruído a parar." });
  };
  
  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valueString = e.target.value;
    if (valueString === '') {
      setIntervalSeconds(NaN); 
      setErrorMessage("O intervalo não pode ser vazio.");
      return;
    }
    const value = parseInt(valueString, 10);
    if (!isNaN(value) && value >= 1 && Number.isInteger(value)) {
      setIntervalSeconds(value);
      setErrorMessage(null);
      if (isSwTracking) { // If SW is tracking, send update
        sendCommandToSW('update-config', { intervalSeconds: value });
        toast({ title: "Intervalo Atualizado", description: `Serviço de fundo usará novo intervalo de ${value}s.` });
      }
    } else {
      setIntervalSeconds(NaN);
      const errorMsg = "Intervalo inválido. Use um número inteiro (mínimo 1).";
      setErrorMessage(errorMsg);
      if (valueString !== '') toast({ title: "Intervalo Inválido", description: errorMsg, variant: "destructive" });
    }
  };

  const handleServerUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newUrl = e.target.value;
      setServerUrl(newUrl);
      try {
          if (newUrl.trim() !== '') { new URL(newUrl); setErrorMessage(null); }
          else setErrorMessage("A URL do Servidor não pode ser vazia.");
      } catch (_) { setErrorMessage("URL do Servidor inválida."); }
  };

  // Determine if the main button should be disabled
  const isStartButtonDisabled = 
    !isServiceWorkerActive ||
    (!isSwTracking && ( // only disable if not tracking AND config is bad
      isNaN(intervalSeconds) ||
      !deviceId || deviceId.trim() === '' ||
      !serverUrl || serverUrl.trim() === '' ||
      (errorMessage !== null && errorMessage.toLowerCase().includes("url"))
    ));


  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-lg rounded-xl border">
        <CardHeader className="p-6">
          <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle>
          <CardDescription className="text-center text-muted-foreground pt-1">
            Rastreamento GPS em segundo plano via Service Worker.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {!isServiceWorkerActive && (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Serviço Indisponível</AlertTitle>
                <AlertDescription>
                    O serviço de rastreamento em segundo plano não pôde ser iniciado.
                    Verifique o console do navegador para erros ou tente recarregar a página.
                    Seu navegador pode não suportar Service Workers ou pode haver um erro de configuração.
                </AlertDescription>
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">Identificador do Dispositivo</Label>
            <Input id="deviceId" placeholder="Insira um ID único" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={isSwTracking || isUiDisabled} className="bg-card rounded-md shadow-sm" aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">ID para o servidor Traccar.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">URL do Servidor Traccar</Label>
            <Input id="serverUrl" placeholder="Ex: http://seu.servidor.com:5055" value={serverUrl} onChange={handleServerUrlChange} disabled={isSwTracking || isUiDisabled} type="url" className={`bg-card rounded-md shadow-sm ${errorMessage?.includes('URL') ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Protocolo OsmAnd (porta padrão 5055). Ex: <code>http://demo.traccar.org:5055</code></p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Envio (segundos)</Label>
            <Input id="interval" type="number" min="1" step="1" placeholder="Mínimo 1 segundo" value={isNaN(intervalSeconds) ? '' : intervalSeconds} onChange={handleIntervalChange} disabled={isSwTracking || isUiDisabled} className={`bg-card rounded-md shadow-sm ${isNaN(intervalSeconds) ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Frequência de envio (mínimo 1s).</p>
          </div>
          
          <div className="flex flex-col items-center space-y-4 pt-2">
            <Button
              onClick={isSwTracking ? handleStopTracking : handleStartTracking}
              className={`w-full text-lg py-3 rounded-md shadow-md transition-colors duration-200 ${
                isSwTracking ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
              aria-label={isSwTracking ? 'Parar Rastreamento em Segundo Plano' : 'Iniciar Rastreamento em Segundo Plano'}
              disabled={isStartButtonDisabled || isUiDisabled} 
            >
              {isUiDisabled && isSwTracking === undefined ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : (isSwTracking ? <Square className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />)}
              {isUiDisabled && isSwTracking === undefined ? 'Verificando...' : (isSwTracking ? 'Parar Rastreamento (Fundo)' : 'Iniciar Rastreamento (Fundo)')}
            </Button>

            <div role="status" aria-live="polite" className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${
                errorMessage ? 'bg-destructive/10 text-destructive' : (isSwTracking ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground')
            }`}>
              { errorMessage ? <AlertCircle className="h-5 w-5"/> : (isSwTracking ? <Settings2 className="h-5 w-5 animate-spin-slow"/> : <WifiOff className="h-5 w-5"/>) } {/* Using Settings2 for active SW */}
              <span className="truncate max-w-xs">{statusMessage}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;

// Add this to your globals.css or a style tag if you want a slow spin:
// @keyframes spin-slow {
//  to {
//    transform: rotate(360deg);
//  }
// }
// .animate-spin-slow {
//  animation: spin-slow 3s linear infinite;
// }
// (Better to add to globals.css)
