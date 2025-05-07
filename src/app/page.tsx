'use client';

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, WifiOff, Loader2, Settings2, XCircle } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055';

const isValidHttpUrl = (string: string): boolean => {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

const TraccarWebClient: NextPage = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10);
  const [isUiDisabled, setIsUiDisabled] = useState<boolean>(false);
  const [isServiceWorkerActive, setIsServiceWorkerActive] = useState<boolean>(false);
  const [isSwTracking, setIsSwTracking] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Aguardando serviço de segundo plano...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const serviceWorkerRef = useRef<ServiceWorkerRegistration | null>(null);
  const { toast } = useToast();
  const isMountedRef = useRef(false);

  const sendCommandToSW = useCallback((command: string, data?: any) => {
    if (serviceWorkerRef.current && serviceWorkerRef.current.active) {
      serviceWorkerRef.current.active.postMessage({ command, data });
    } else {
      toast({ title: "Service Worker Inativo", description: "Não foi possível comunicar com o serviço de segundo plano.", variant: "destructive"});
    }
  }, [toast]);

  useEffect(() => {
    isMountedRef.current = true;
    if ('serviceWorker' in navigator) {
      const swFile = '/traccar-service-worker.js';
      navigator.serviceWorker.register(swFile)
        .then(registration => {
          serviceWorkerRef.current = registration;
          setIsServiceWorkerActive(true);
          setStatusMessage('Serviço de segundo plano registrado. Verificando status...');
          toast({ title: "Serviço Registrado", description: "Serviço de rastreamento em segundo plano pronto." });
          
          if (isMountedRef.current) sendCommandToSW('get-status');

          navigator.serviceWorker.onmessage = (event) => {
            if (!isMountedRef.current) return;
            const { type, message, isTracking: swIsTrackingStatus } = event.data;
            
            switch (type) {
              case 'status':
                setStatusMessage(message);
                break;
              case 'error':
                setErrorMessage(message);
                setStatusMessage(prev => prev.includes("Iniciando") || prev.includes("Verificando") ? "Falha na operação do serviço." : "Erro no serviço.");
                toast({ title: "Erro no Serviço", description: message, variant: "destructive" });
                break;
              case 'success':
                setStatusMessage(`[SW] ${message} (${new Date().toLocaleTimeString()})`);
                setErrorMessage(null);
                toast({ title: "Sucesso", description: message });
                break;
              case 'tracking_status':
                setIsSwTracking(swIsTrackingStatus);
                setStatusMessage(message || (swIsTrackingStatus ? "Rastreamento ativo em segundo plano." : "Rastreamento parado em segundo plano."));
                if (swIsTrackingStatus) {
                  setErrorMessage(null); 
                } else {
                  if (message && (message.toLowerCase().includes("falha") || message.toLowerCase().includes("negada") || message.toLowerCase().includes("não suportada")|| message.toLowerCase().includes("indisponível"))) {
                    setErrorMessage(message); 
                    if (!message.toLowerCase().includes("interrompido")) { // Avoid toast for normal stop
                        toast({ title: "Rastreamento Não Ativo", description: message, variant: "destructive" });
                    }
                  }
                }
                break;
              default:
                // console.log("Mensagem SW desconhecida:", event.data);
            }
          };
        })
        .catch(error => {
          console.error('Falha ao registrar Service Worker:', error);
          const swErrorMsg = "Falha crítica ao registrar serviço de segundo plano. Rastreamento em segundo plano não funcionará.";
          setErrorMessage(swErrorMsg);
          setStatusMessage("Serviço de segundo plano indisponível.");
          toast({ title: "Erro Crítico de Serviço", description: swErrorMsg, variant: "destructive" });
          setIsServiceWorkerActive(false);
        });
    } else {
      const noSwSupportMsg = "Service Workers não são suportados neste navegador. Rastreamento em segundo plano está desabilitado.";
      setErrorMessage(noSwSupportMsg);
      setStatusMessage("Navegador incompatível.");
      toast({ title: "Navegador Incompatível", description: noSwSupportMsg, variant: "destructive" });
      setIsServiceWorkerActive(false);
    }
    return () => {
        isMountedRef.current = false;
        if (navigator.serviceWorker) {
            navigator.serviceWorker.onmessage = null; 
        }
    };
  }, [sendCommandToSW, toast]);

  useEffect(() => {
    try {
      const savedDeviceId = localStorage.getItem('traccarDeviceId');
      const savedServerUrl = localStorage.getItem('traccarServerUrl');
      const savedInterval = localStorage.getItem('traccarIntervalSeconds');

      if (savedDeviceId) setDeviceId(savedDeviceId);
      
      let urlToSet = DEFAULT_SERVER_URL;
      if (savedServerUrl) {
        if (isValidHttpUrl(savedServerUrl) && savedServerUrl.trim() !== '') urlToSet = savedServerUrl;
        else { console.warn("URL salva inválida, usando padrão:", savedServerUrl); localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL); }
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

  useEffect(() => { if (deviceId.trim() !== '') localStorage.setItem('traccarDeviceId', deviceId); else localStorage.removeItem('traccarDeviceId'); }, [deviceId]);
  useEffect(() => { if (serverUrl && serverUrl.trim() !== '' && isValidHttpUrl(serverUrl)) localStorage.setItem('traccarServerUrl', serverUrl); }, [serverUrl]);
  useEffect(() => { if (!isNaN(intervalSeconds) && intervalSeconds >= 1 && Number.isInteger(intervalSeconds)) localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString()); }, [intervalSeconds]);

  const requestLocationPermission = async (): Promise<boolean> => {
    if (!('geolocation' in navigator)) {
      const noGeoMsg = "Geolocalização não é suportada neste navegador.";
      setErrorMessage(noGeoMsg);
      toast({ title: "GPS Não Suportado", description: noGeoMsg, variant: "destructive" });
      return false;
    }
    try {
      const permissionStatus = await navigator.permissions.query({ name: 'geolocation' });
      if (permissionStatus.state === 'granted') {
        return true;
      } else if (permissionStatus.state === 'prompt') {
        return new Promise<boolean>((resolve) => {
            navigator.geolocation.getCurrentPosition(
                () => {
                    toast({title: "Permissão Concedida", description: "Permissão de localização obtida para a página."});
                    resolve(true);
                },
                (error) => {
                    const permErrorMsg = "Permissão de localização negada ou erro ao solicitar para a página.";
                    setErrorMessage(permErrorMsg);
                    toast({ title: "Permissão Necessária", description: "A permissão de localização é necessária para o rastreamento.", variant: "destructive" });
                    resolve(false);
                },
                { timeout: 10000 } 
            );
        });
      } else { 
        const deniedMsg = "Permissão de localização foi negada. Habilite nas configurações do navegador para este site.";
        setErrorMessage(deniedMsg);
        toast({ title: "Permissão Negada", description: deniedMsg, variant: "destructive" });
        return false;
      }
    } catch (error) {
      const queryErrorMsg = "Erro ao verificar/solicitar permissão de localização.";
      console.error(queryErrorMsg, error);
      setErrorMessage(queryErrorMsg);
      toast({ title: "Erro de Permissão", description: queryErrorMsg, variant: "destructive" });
      return false;
    }
  };

  const handleStartTracking = async () => {
    let hasError = false;
    if (!deviceId || deviceId.trim() === '') {
      setErrorMessage("Configure o ID do Dispositivo."); toast({ title: "Configuração Incompleta", description: "Insira um ID do Dispositivo.", variant: "destructive" }); hasError = true;
    }
    if (!serverUrl || serverUrl.trim() === '' || !isValidHttpUrl(serverUrl)) {
      setErrorMessage(`URL do Servidor inválida: ${serverUrl}. Use http:// ou https://.`); toast({ title: "URL Inválida", description: "Insira uma URL de servidor válida.", variant: "destructive" }); hasError = true;
    }
    if (isNaN(intervalSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
      setErrorMessage("Intervalo inválido. Deve ser um número inteiro maior ou igual a 1."); toast({ title: "Intervalo Inválido", description: "Insira um intervalo válido (número >= 1).", variant: "destructive" }); hasError = true;
    }
    if (!isServiceWorkerActive) {
      setErrorMessage("Serviço de segundo plano não está ativo. Tente recarregar a página."); toast({ title: "Serviço Inativo", description: "O serviço de segundo plano não iniciou.", variant: "destructive" }); hasError = true;
    }
     if (errorMessage && (errorMessage.includes("Geolocalização não suportada") || errorMessage.includes("indisponível no worker"))) {
        toast({ title: "Impossível Iniciar", description: "Geolocalização não é suportada pelo serviço de segundo plano neste navegador.", variant: "destructive" });
        hasError = true;
    }


    if (hasError) return;

    const permissionGranted = await requestLocationPermission(); // This is for PAGE permissions, SW checks its own.
    if (!permissionGranted) {
        // Error message already set by requestLocationPermission or user denied prompt
        return;
    }

    setStatusMessage("Iniciando rastreamento em segundo plano...");
    setErrorMessage(null); // Clear previous errors before attempting to start
    sendCommandToSW('start-tracking', { deviceId, serverUrl, intervalSeconds });
  };

  const handleStopTracking = () => {
    setStatusMessage("Parando rastreamento em segundo plano...");
    sendCommandToSW('stop-tracking');
    toast({ title: "Rastreamento Interrompido", description: "O serviço de segundo plano foi instruído a parar." });
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
      if (isSwTracking) { 
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
      if (!newUrl || newUrl.trim() === '') {
          setErrorMessage("A URL do Servidor não pode ser vazia.");
      } else if (!isValidHttpUrl(newUrl)) {
          setErrorMessage("URL do Servidor inválida. Formato esperado: http:// ou https://");
      } else {
          setErrorMessage(null);
      }
  };

  const criticalErrorPreventingStart = errorMessage && 
      (errorMessage.toLowerCase().includes("geolocalização não suportada") ||
       errorMessage.toLowerCase().includes("indisponível no worker") ||
       errorMessage.toLowerCase().includes("permissão de localização negada"));

  const isConfigurationInvalid = 
    !deviceId || deviceId.trim() === '' ||
    !serverUrl || serverUrl.trim() === '' || !isValidHttpUrl(serverUrl) ||
    isNaN(intervalSeconds) || intervalSeconds < 1;

  const startButtonShouldBeDisabled =
    !isServiceWorkerActive ||
    isUiDisabled ||
    (!isSwTracking && (isConfigurationInvalid || !!criticalErrorPreventingStart));


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
          {!isServiceWorkerActive && !errorMessage?.includes("Falha crítica ao registrar") && ( // Don't show if a more specific SW registration error is already shown
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Serviço Indisponível</AlertTitle>
                <AlertDescription>
                    O serviço de rastreamento em segundo plano não está ativo.
                    Seu navegador pode não suportar Service Workers, ou pode haver um erro.
                </AlertDescription>
            </Alert>
          )}
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <XCircle className="h-4 w-4" />
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
            <Input id="serverUrl" placeholder="Ex: http://seu.servidor.com:5055" value={serverUrl} onChange={handleServerUrlChange} disabled={isSwTracking || isUiDisabled} type="url" className={`bg-card rounded-md shadow-sm ${errorMessage?.includes('URL do Servidor inválida') ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Protocolo OsmAnd (porta padrão 5055). Ex: <code>http://demo.traccar.org:5055</code></p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Envio (segundos)</Label>
            <Input id="interval" type="number" min="1" step="1" placeholder="Mínimo 1 segundo" value={isNaN(intervalSeconds) ? '' : intervalSeconds} onChange={handleIntervalChange} disabled={isSwTracking || isUiDisabled} className={`bg-card rounded-md shadow-sm ${errorMessage?.includes('Intervalo inválido') || isNaN(intervalSeconds) ? 'border-destructive ring-destructive' : ''}`} aria-required="true"/>
            <p className="text-xs text-muted-foreground pt-1">Frequência de envio (mínimo 1s).</p>
          </div>
          
          <div className="flex flex-col items-center space-y-4 pt-2">
            <Button
              onClick={isSwTracking ? handleStopTracking : handleStartTracking}
              className={`w-full text-lg py-3 rounded-md shadow-md transition-colors duration-200 ${
                isSwTracking ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
              aria-label={isSwTracking ? 'Parar Rastreamento em Segundo Plano' : 'Iniciar Rastreamento em Segundo Plano'}
              disabled={startButtonShouldBeDisabled} 
            >
              {isUiDisabled && statusMessage.includes("Verificando") ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : (isSwTracking ? <Square className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />)}
              {isUiDisabled && statusMessage.includes("Verificando") ? 'Verificando...' : (isSwTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento')}
            </Button>

            <div role="status" aria-live="polite" className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${
                errorMessage ? 'bg-destructive/10 text-destructive' : (isSwTracking ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-foreground')
            }`}>
              { errorMessage ? <XCircle className="h-5 w-5"/> : (isSwTracking ? <Settings2 className="h-5 w-5 animate-spin-slow"/> : <WifiOff className="h-5 w-5"/>) }
              <span className="truncate max-w-xs">{statusMessage}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;
