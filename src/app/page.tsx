
"use client";

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, Wifi, WifiOff, Loader2 } from 'lucide-react'; // Added Loader2
import { useToast } from "@/hooks/use-toast";
import { sendTraccarData, type SendTraccarDataInput } from './actions'; // Import the server action

const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055';

const TraccarWebClient: NextPage = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false); // New state for sending status
  const [statusMessage, setStatusMessage] = useState<string>('Parado');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  // Load config from localStorage on mount
  useEffect(() => {
    try {
      const savedDeviceId = localStorage.getItem('traccarDeviceId');
      const savedServerUrl = localStorage.getItem('traccarServerUrl');
      const savedInterval = localStorage.getItem('traccarIntervalSeconds');

      if (savedDeviceId) setDeviceId(savedDeviceId);
      if (savedServerUrl && savedServerUrl.trim() !== '') {
        setServerUrl(savedServerUrl);
      } else {
        setServerUrl(DEFAULT_SERVER_URL);
        localStorage.setItem('traccarServerUrl', DEFAULT_SERVER_URL);
      }
      if (savedInterval) {
        const parsedInterval = parseInt(savedInterval, 10);
        if (!isNaN(parsedInterval) && parsedInterval > 0) {
          setIntervalSeconds(parsedInterval);
        }
      }
    } catch (error) {
      console.error("Erro ao acessar localStorage:", error);
      setErrorMessage("Não foi possível carregar as configurações salvas. O LocalStorage pode estar indisponível.");
    }
  }, []);

  // Save config to localStorage when inputs change
  useEffect(() => {
    try {
      if (deviceId.trim() !== '') {
        localStorage.setItem('traccarDeviceId', deviceId);
      }
    } catch (error) {
      console.error("Erro ao salvar deviceId no localStorage:", error);
    }
  }, [deviceId]);

  useEffect(() => {
    try {
      if (serverUrl.trim() !== '') {
        localStorage.setItem('traccarServerUrl', serverUrl);
      }
    } catch (error) {
      console.error("Erro ao salvar serverUrl no localStorage:", error);
    }
  }, [serverUrl]);

  useEffect(() => {
    if (!isNaN(intervalSeconds) && intervalSeconds > 0 && Number.isInteger(intervalSeconds)) {
      try {
        localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString());
      } catch (error) {
        console.error("Erro ao salvar intervalSeconds no localStorage:", error);
      }
    }
  }, [intervalSeconds]);

  // Cleanup interval on unmount or when tracking stops
  useEffect(() => {
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, []);

  const sendLocationData = useCallback(async (position: GeolocationPosition) => {
    if (!deviceId || !serverUrl) {
      setErrorMessage("ID do Dispositivo e URL do Servidor são obrigatórios.");
      setIsTracking(false); // Stop tracking if config is missing
      setStatusMessage("Parado - Configuração necessária");
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      return;
    }

     // Basic URL validation (client-side check before sending to server action)
    try {
        const validatedUrl = new URL(serverUrl);
        if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
            throw new Error("Protocolo inválido. Use http ou https.");
        }
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : "URL inválida";
        setErrorMessage(`URL do Servidor inválida: ${serverUrl}. ${errMsg}`);
        setIsTracking(false);
        setStatusMessage("Erro de Configuração");
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
        return;
    }


    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000);

    const dataToSend: SendTraccarDataInput = {
      serverUrl,
      deviceId,
      lat: latitude,
      lon: longitude,
      timestamp: timestamp,
      // Only include optional values if they are not null
      ...(accuracy !== null && { accuracy: accuracy }),
      ...(altitude !== null && { altitude: altitude }),
      ...(speed !== null && speed >= 0 && { speed: speed }),
       // Use 'bearing' for heading, ensuring it's non-negative
      ...(heading !== null && heading >= 0 && { bearing: heading }),
    };

    setStatusMessage(`Enviando localização... (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`);
    setErrorMessage(null);
    setIsSending(true); // Indicate sending started

    try {
      // Call the server action
      const result = await sendTraccarData(dataToSend);

      if (result.success) {
        // console.log('Server Action: Location sent successfully');
        toast({
          title: "Localização Enviada",
          description: `Dados enviados para ${new URL(serverUrl).hostname}.`, // Show only hostname
        });
        // Status message will be updated by the next interval or if stopped
        setStatusMessage(`Último envio: ${new Date().toLocaleTimeString()}`);
      } else {
        // Error occurred in the server action
        console.error("Server Action Error:", result.message);
        const detailedError = `Falha no envio (servidor): ${result.message || 'Erro desconhecido.'}`;
        setErrorMessage(detailedError);
        setStatusMessage("Erro no Envio");
        toast({
          title: "Erro no Envio",
          description: detailedError,
          variant: "destructive",
        });
      }
    } catch (error) {
      // Catch unexpected errors during the server action call itself (e.g., network issue client-side)
      console.error("Erro ao chamar Server Action:", error);
      let errMsg = 'Erro inesperado ao tentar contatar o servidor da aplicação.';
       if (error instanceof Error) {
           errMsg = `Erro: ${error.message}`;
       }
      setErrorMessage(errMsg);
      setStatusMessage("Erro na Comunicação");
      toast({
        title: "Erro de Comunicação",
        description: errMsg,
        variant: "destructive",
      });
    } finally {
      setIsSending(false); // Indicate sending finished
    }
  }, [deviceId, serverUrl, toast]); // Removed intervalSeconds, added isSending

  const handleTracking = useCallback(() => {
     // Prevent multiple simultaneous sends if interval is shorter than send time
    if (isSending) {
        console.log("Aguardando envio anterior...");
        setStatusMessage("Aguardando envio anterior...");
        return;
    }

    if (!('geolocation' in navigator)) {
      setErrorMessage("Geolocalização não é suportada por este navegador.");
      setIsTracking(false);
      setStatusMessage("GPS Não Suportado");
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      toast({
        title: "GPS Não Suportado",
        description: "Geolocalização não é suportada por este navegador.",
        variant: "destructive",
      });
      return;
    }

    const handleGeoError = (error: GeolocationPositionError) => {
      console.error("Erro ao obter localização:", error);
      let errMsg = `Erro de GPS: ${error.message} (Código: ${error.code}).`;
      switch (error.code) {
        case error.PERMISSION_DENIED:
          errMsg += " Permissão negada. Habilite a localização para este site nas configurações do navegador.";
          break;
        case error.POSITION_UNAVAILABLE:
          errMsg += " Posição não disponível. Verifique se o GPS está ativado e com boa recepção.";
          break;
        case error.TIMEOUT:
          errMsg += " Tempo esgotado para obter a localização.";
          break;
        default:
          errMsg += " Erro desconhecido ao obter localização.";
          break;
      }
      setErrorMessage(errMsg);
      // Don't necessarily stop tracking on a single GPS error, maybe it's temporary
      // setIsTracking(false);
      setStatusMessage("Erro de GPS");
      // if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      // intervalIdRef.current = null;
      toast({
        title: "Erro de GPS",
        description: errMsg,
        variant: "destructive",
      });
    };

    const handleGeoSuccess = (position: GeolocationPosition) => {
      sendLocationData(position); // Send immediately on success
    };

    setStatusMessage('Obtendo localização GPS...');
    navigator.geolocation.getCurrentPosition(
      handleGeoSuccess,
      handleGeoError,
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );
  }, [sendLocationData, toast, isSending]); // Added isSending dependency

  const startTracking = useCallback(() => {
    if (!deviceId || !serverUrl) {
      setErrorMessage("ID do Dispositivo e URL do Servidor devem ser configurados antes de iniciar.");
      toast({
        title: "Configuração Incompleta",
        description: "Por favor, insira o ID do Dispositivo e a URL do Servidor.",
        variant: "destructive",
      });
      return;
    }
    if (isNaN(intervalSeconds) || !Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      setErrorMessage("O intervalo deve ser um número inteiro positivo de segundos.");
      toast({
        title: "Intervalo Inválido",
        description: "O intervalo de rastreamento deve ser um número inteiro positivo.",
        variant: "destructive",
      });
      return;
    }

    try {
      const validatedUrl = new URL(serverUrl);
      if (!['http:', 'https:'].includes(validatedUrl.protocol)) {
        throw new Error("Protocolo inválido.");
      }
    } catch (_) {
      setErrorMessage(`URL do Servidor inválida: ${serverUrl}. Use http:// ou https://`);
      toast({
        title: "URL Inválida",
        description: "Por favor, insira uma URL válida para o servidor (http:// ou https://).",
        variant: "destructive",
      });
      return;
    }

    if (!('geolocation' in navigator)) {
      setErrorMessage("Geolocalização não é suportada por este navegador. Não é possível iniciar o rastreamento.");
      toast({
        title: "GPS Não Suportado",
        description: "Não é possível iniciar o rastreamento sem suporte à geolocalização do navegador.",
        variant: "destructive",
      });
      return;
    }

    setIsTracking(true);
    setStatusMessage("Iniciando...");
    setErrorMessage(null);

    handleTracking(); // Attempt initial send immediately

    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
    }

    intervalIdRef.current = setInterval(handleTracking, intervalSeconds * 1000);

    toast({
      title: "Rastreamento Iniciado",
      description: `Enviando localização a cada ${intervalSeconds} segundos.`,
    });

  }, [deviceId, serverUrl, intervalSeconds, handleTracking, toast]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    setStatusMessage("Parado");
    setErrorMessage(null);
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
     // Reset sending state if stopped manually
    setIsSending(false);
    toast({
      title: "Rastreamento Parado",
    });
  }, [toast]);

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
      if (isTracking) {
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = setInterval(handleTracking, value * 1000);
        toast({
          title: "Intervalo Atualizado",
          description: `Agora enviando localização a cada ${value} segundos.`,
        });
      }
    } else {
      setIntervalSeconds(NaN);
      const errorMsg = "O intervalo deve ser um número inteiro positivo maior que zero.";
      setErrorMessage(errorMsg);
      toast({
        title: "Intervalo Inválido",
        description: errorMsg,
        variant: "destructive",
      });
      if (isTracking && intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
        setStatusMessage("Intervalo Inválido - Rastreamento Pausado");
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-lg rounded-xl border">
        <CardHeader className="p-6">
          <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle>
          <CardDescription className="text-center text-muted-foreground pt-1">
            Envie a localização do seu navegador para o servidor Traccar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">Identificador do Dispositivo</Label>
            <Input
              id="deviceId"
              placeholder="Insira um ID único para o dispositivo"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={isTracking}
              className="bg-card rounded-md shadow-sm"
              aria-required="true"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">URL do Servidor Traccar</Label>
            <Input
              id="serverUrl"
              placeholder="Ex: http://seu.servidor.com:5055"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={isTracking}
              type="url"
              className="bg-card rounded-md shadow-sm"
              aria-required="true"
            />
             {/* Updated help text */}
             <p className="text-xs text-muted-foreground pt-1">Use protocolo HTTP ou HTTPS. Porta padrão OsmAnd: 5055. A conexão é feita pelo servidor da aplicação.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Rastreamento (segundos)</Label>
            <Input
              id="interval"
              type="number"
              min="1"
              step="1"
              placeholder="Mínimo 1 segundo"
              value={isNaN(intervalSeconds) ? '' : intervalSeconds}
              onChange={handleIntervalChange}
              className={`bg-card rounded-md shadow-sm ${isNaN(intervalSeconds) ? 'border-destructive ring-destructive' : ''}`}
              aria-required="true"
              aria-invalid={isNaN(intervalSeconds)}
            />
          </div>

          <div className="flex flex-col items-center space-y-4 pt-2">
            <Button
              onClick={isTracking ? stopTracking : startTracking}
              className={`w-full text-lg py-3 rounded-md shadow-md transition-colors duration-200 ${
                isTracking
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
              aria-label={isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento'}
              // Disable start if config invalid, interval invalid, or currently sending
              disabled={isSending || (!isTracking && (isNaN(intervalSeconds) || !deviceId || !serverUrl))}
            >
              {isSending ? (
                 <Loader2 className="mr-2 h-5 w-5 animate-spin" /> // Show spinner when sending
              ) : isTracking ? (
                 <Square className="mr-2 h-5 w-5" />
              ) : (
                 <Play className="mr-2 h-5 w-5" />
              )}
              {isSending ? 'Enviando...' : (isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento')}
            </Button>

            <div className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${
              errorMessage
                ? 'bg-destructive/10 text-destructive'
                : isTracking
                ? 'bg-accent/10 text-accent'
                : 'bg-muted text-muted-foreground'
            }`}>
              { errorMessage ? <AlertCircle className="h-5 w-5"/> : (isTracking ? <Wifi className="h-5 w-5"/> : <WifiOff className="h-5 w-5"/>) }
              <span className="truncate max-w-xs">{statusMessage}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;
