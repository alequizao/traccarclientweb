"use client";

import type { NextPage } from 'next';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play, Square, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const DEFAULT_SERVER_URL = 'http://65.21.243.46:5055';

const TraccarWebClient: NextPage = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>(DEFAULT_SERVER_URL); // Set default server URL
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Parado'); // Translated
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
        // Only overwrite default if a saved URL exists
        if (savedServerUrl) setServerUrl(savedServerUrl);
        if (savedInterval) setIntervalSeconds(parseInt(savedInterval, 10));
    } catch (error) {
        console.error("Erro ao acessar localStorage:", error); // Translated
        setErrorMessage("Não foi possível carregar as configurações salvas. O LocalStorage pode estar indisponível."); // Translated
    }
  }, []);

  // Save config to localStorage when inputs change
  useEffect(() => {
    try {
        localStorage.setItem('traccarDeviceId', deviceId);
    } catch (error) {
        console.error("Erro ao salvar deviceId no localStorage:", error); // Translated
    }
  }, [deviceId]);

  useEffect(() => {
     try {
        // Don't save the default URL unless it's explicitly changed by the user
        // This check might be redundant if state only updates on change, but good for clarity
        if (serverUrl !== DEFAULT_SERVER_URL || localStorage.getItem('traccarServerUrl')) {
           localStorage.setItem('traccarServerUrl', serverUrl);
        }
     } catch (error) {
         console.error("Erro ao salvar serverUrl no localStorage:", error); // Translated
     }
  }, [serverUrl]);

  useEffect(() => {
    try {
        localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString());
    } catch (error) {
        console.error("Erro ao salvar intervalSeconds no localStorage:", error); // Translated
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
      setErrorMessage("ID do Dispositivo e URL do Servidor são obrigatórios."); // Translated
      setIsTracking(false);
      setStatusMessage("Parado"); // Translated
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      return;
    }

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000); // Convert ms to seconds

    // Basic URL validation
    try {
        new URL(serverUrl);
    } catch (_) {
        setErrorMessage(`URL do Servidor inválida: ${serverUrl}`); // Translated
        setIsTracking(false);
        setStatusMessage("Erro de Configuração"); // Translated
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
        return;
    }


    const params = new URLSearchParams({
      id: deviceId,
      lat: latitude.toString(),
      lon: longitude.toString(),
      timestamp: timestamp.toString(),
    });

    // Add optional parameters if they are available and valid
    if (accuracy !== null) params.append('accuracy', accuracy.toString());
    if (altitude !== null) params.append('altitude', altitude.toString());
    // Ensure speed is non-negative before sending
    if (speed !== null && speed >= 0) params.append('speed', speed.toString());
    // Ensure heading is non-negative before sending
    if (heading !== null && heading >= 0) params.append('bearing', heading.toString());

    // Ensure serverUrl ends with a single slash before appending query params
    const baseUrl = serverUrl.replace(/\/$/, '');
    const urlWithParams = `${baseUrl}/?${params.toString()}`;


    setStatusMessage(`Enviando localização... (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`); // Translated
    setErrorMessage(null); // Clear previous errors on successful attempt

    try {
      const response = await fetch(urlWithParams, {
        method: 'POST', // Traccar typically expects POST for osmAnd protocol
        // mode: 'no-cors', // Removed 'no-cors' to get potentially clearer CORS errors
        // Add headers if needed by the server, though osmand protocol usually doesn't require them
        // headers: {
        //   'Content-Type': 'application/x-www-form-urlencoded', // Example if needed
        // },
      });

      // Basic check for HTTP success codes (won't work fully with redirects if fetch doesn't follow)
      if (response.ok) {
          // console.log('Location sent successfully');
          toast({
              title: "Localização Enviada", // Translated
              description: `Dados enviados para ${baseUrl}`, // Translated
          });
      } else {
          // Try to get more info if possible (might be limited by CORS)
          const statusText = response.statusText || `Código ${response.status}`;
          console.error("Falha ao enviar localização - Resposta não OK:", response.status, statusText); // Translated
          setErrorMessage(`Falha ao enviar localização: ${statusText}. Verifique URL, rede e CORS do servidor.`); // Translated
          setStatusMessage("Erro no Envio"); // Translated
           toast({
              title: "Erro no Envio", // Translated
              description: `Falha ao enviar dados: ${statusText}`, // Translated
              variant: "destructive",
          });
      }

    } catch (error) {
      console.error("Falha ao enviar localização (Fetch Error):", error); // Translated error context
      // Distinguish between different error types if possible
      let errMsg = 'Erro de rede desconhecido'; // Translated
      if (error instanceof TypeError) {
         // TypeError often relates to network issues (DNS, connection refused) or CORS preflight failures
         errMsg = `Erro de rede ou CORS: ${error.message}. Verifique a conexão e a configuração CORS do servidor.`; // Translated
      } else if (error instanceof Error) {
         errMsg = error.message;
      }

      setErrorMessage(`Falha ao enviar localização: ${errMsg}`); // Translated
      setStatusMessage("Erro no Envio"); // Translated
       toast({
          title: "Erro no Envio", // Translated
          description: `Falha ao enviar dados: ${errMsg}`, // Translated
          variant: "destructive",
      });
    }
  }, [deviceId, serverUrl, toast]);

  const handleTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
        setErrorMessage("Geolocalização não é suportada por este navegador."); // Translated
        setIsTracking(false);
        setStatusMessage("GPS Não Suportado"); // Translated
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
         toast({
            title: "GPS Não Suportado", // Translated
            description: "Geolocalização não é suportada por este navegador.", // Translated
            variant: "destructive",
        });
        return; // Exit early if geolocation is not available
    }

    // Define error handler function separately
    const handleGeoError = (error: GeolocationPositionError) => {
        console.error("Erro ao obter localização:", error); // Translated
        const errMsg = `Erro de GPS: ${error.message} (Código: ${error.code}). Por favor, habilite os serviços de localização e garanta as permissões.`; // Translated
        setErrorMessage(errMsg);
        setIsTracking(false); // Stop tracking if location fetch fails
        setStatusMessage("Erro de GPS"); // Translated
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
         toast({
            title: "Erro de GPS", // Translated
            description: errMsg,
            variant: "destructive",
        });
    };

    // Define success handler function separately
    const handleGeoSuccess = (position: GeolocationPosition) => {
        sendLocationData(position); // Send immediately on success
    };

    // Request current position
    navigator.geolocation.getCurrentPosition(
        handleGeoSuccess,
        handleGeoError,
        {
            enableHighAccuracy: true,
            maximumAge: 0, // Force fresh data
            timeout: 10000, // 10 seconds timeout
        }
    );

  }, [sendLocationData, toast]);

  const startTracking = useCallback(() => {
    // Validation checks
    if (!deviceId || !serverUrl) {
      setErrorMessage("ID do Dispositivo e URL do Servidor devem ser configurados antes de iniciar."); // Translated
      toast({
        title: "Configuração Incompleta", // Translated
        description: "Por favor, insira o ID do Dispositivo e a URL do Servidor.", // Translated
        variant: "destructive",
      });
      return;
    }
     if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      setErrorMessage("O intervalo deve ser um número inteiro positivo de segundos."); // Translated
       toast({
        title: "Intervalo Inválido", // Translated
        description: "O intervalo de rastreamento deve ser um número inteiro positivo.", // Translated
        variant: "destructive",
      });
      return;
    }

    // Basic URL validation before starting
    try {
        new URL(serverUrl);
    } catch (_) {
        setErrorMessage(`URL do Servidor inválida: ${serverUrl}`); // Translated
        toast({
            title: "URL Inválida", // Translated
            description: "Por favor, insira uma URL válida para o servidor.", // Translated
            variant: "destructive",
        });
        return;
    }


    // Check geolocation support again before starting interval
    if (!('geolocation' in navigator)) {
       setErrorMessage("Geolocalização não é suportada por este navegador. Não é possível iniciar o rastreamento."); // Translated
       toast({
           title: "GPS Não Suportado", // Translated
           description: "Não é possível iniciar o rastreamento sem suporte à geolocalização do navegador.", // Translated
           variant: "destructive",
       });
       return;
    }


    setIsTracking(true);
    setStatusMessage("Iniciando..."); // Translated
    setErrorMessage(null); // Clear any previous errors

    handleTracking(); // Attempt initial send immediately

    // Clear existing interval before setting a new one, just in case
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
    }

    // Set up the interval timer
    intervalIdRef.current = setInterval(handleTracking, intervalSeconds * 1000);

    toast({
        title: "Rastreamento Iniciado", // Translated
        description: `Enviando localização a cada ${intervalSeconds} segundos.`, // Translated
    });

  }, [deviceId, serverUrl, intervalSeconds, handleTracking, toast]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    setStatusMessage("Parado"); // Translated
    setErrorMessage(null); // Clear errors when stopped
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    toast({
        title: "Rastreamento Parado", // Translated
    });
  }, [toast]);

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
     // Allow empty input temporarily, maybe default to 1 or show validation later
    if (e.target.value === '') {
        setIntervalSeconds(NaN); // Use NaN to indicate invalid state temporarily
        return;
    }
    // Only update if it's a positive integer
    if (!isNaN(value) && value >= 1 && Number.isInteger(value)) {
      setIntervalSeconds(value);
       // If tracking is active, immediately restart the interval with the new value
       if (isTracking) {
         if (intervalIdRef.current) clearInterval(intervalIdRef.current);
         intervalIdRef.current = setInterval(handleTracking, value * 1000);
         toast({
             title: "Intervalo Atualizado", // Translated
             description: `Agora enviando localização a cada ${value} segundos.`, // Translated
         });
       }
    } else {
        // Optionally provide feedback for invalid input (e.g., non-integer, zero, negative)
        toast({
            title: "Intervalo Inválido", // Translated
            description: "O intervalo deve ser um número inteiro positivo.", // Translated
            variant: "destructive",
        });
        // You might want to revert to the previous valid value or keep the NaN state
        // For now, just showing a toast. The startTracking function will prevent starting with NaN.
    }
  };


  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-lg rounded-xl border">
        <CardHeader className="p-6">
          <CardTitle className="text-2xl font-bold text-center text-foreground">Cliente Web Traccar</CardTitle> {/* Translated */}
          <CardDescription className="text-center text-muted-foreground pt-1">
            Envie a localização do seu navegador para o servidor Traccar. {/* Translated */}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Erro</AlertTitle> {/* Translated */}
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">Identificador do Dispositivo</Label> {/* Translated */}
            <Input
              id="deviceId"
              placeholder="Insira um ID único para o dispositivo" // Translated
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={isTracking}
              className="bg-card rounded-md shadow-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">URL do Servidor Traccar</Label> {/* Translated */}
            <Input
              id="serverUrl"
              placeholder={DEFAULT_SERVER_URL} // Show default as placeholder
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={isTracking}
              type="url"
              className="bg-card rounded-md shadow-sm"
            />
             <p className="text-xs text-muted-foreground pt-1">Certifique-se que a URL usa a porta 5055 (protocolo osmand).</p> {/* Translated */}
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Intervalo de Rastreamento (segundos)</Label> {/* Translated */}
            <Input
              id="interval"
              type="number"
              min="1"
              step="1" // Ensure whole numbers
              value={isNaN(intervalSeconds) ? '' : intervalSeconds} // Show empty string if NaN
              onChange={handleIntervalChange}
              className="bg-card rounded-md shadow-sm"
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
              aria-label={isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento'} // Translated
              disabled={isTracking ? false : (isNaN(intervalSeconds) || !deviceId || !serverUrl)} // Disable start if config invalid
            >
              {isTracking ? <Square className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />}
              {isTracking ? 'Parar Rastreamento' : 'Iniciar Rastreamento'} {/* Translated */}
            </Button>

             <div className={`flex items-center space-x-2 py-2 px-4 rounded-full text-sm font-medium transition-colors duration-200 ${
                 errorMessage
                 ? 'bg-destructive/10 text-destructive'
                 : isTracking
                 ? 'bg-accent/10 text-accent'
                 : 'bg-muted text-muted-foreground'
              }`}>
              { errorMessage ? <AlertCircle className="h-5 w-5"/> : (isTracking ? <Wifi className="h-5 w-5"/> : <WifiOff className="h-5 w-5"/>) }
              <span>{statusMessage}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TraccarWebClient;
