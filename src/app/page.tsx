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
// Toaster import removed as it's not used directly here anymore
// import { Toaster } from "@/components/ui/toaster";

const TraccarWebClient: NextPage = () => {
  const [deviceId, setDeviceId] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>('');
  const [intervalSeconds, setIntervalSeconds] = useState<number>(10);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('Stopped');
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
        if (savedServerUrl) setServerUrl(savedServerUrl);
        if (savedInterval) setIntervalSeconds(parseInt(savedInterval, 10));
    } catch (error) {
        console.error("Error accessing localStorage:", error);
        // Handle cases where localStorage might be disabled or unavailable
        setErrorMessage("Could not load saved settings. LocalStorage might be unavailable.");
    }
  }, []);

  // Save config to localStorage when inputs change
  useEffect(() => {
    try {
        localStorage.setItem('traccarDeviceId', deviceId);
    } catch (error) {
        console.error("Error saving deviceId to localStorage:", error);
    }
  }, [deviceId]);

  useEffect(() => {
     try {
        localStorage.setItem('traccarServerUrl', serverUrl);
     } catch (error) {
         console.error("Error saving serverUrl to localStorage:", error);
     }
  }, [serverUrl]);

  useEffect(() => {
    try {
        localStorage.setItem('traccarIntervalSeconds', intervalSeconds.toString());
    } catch (error) {
        console.error("Error saving intervalSeconds to localStorage:", error);
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
      setErrorMessage("Device ID and Server URL are required.");
      setIsTracking(false);
      setStatusMessage("Stopped");
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
      return;
    }

    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    const timestamp = Math.round(position.timestamp / 1000); // Convert ms to seconds

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


    setStatusMessage(`Sending location... (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`);
    setErrorMessage(null); // Clear previous errors on successful attempt

    try {
      const response = await fetch(urlWithParams, {
        method: 'POST', // Traccar typically expects POST for osmAnd protocol
        mode: 'no-cors', // Often needed for direct browser-to-Traccar communication without CORS headers from server
      });

      // Note: With 'no-cors', we cannot reliably read the response status or body.
      // We assume success if the fetch doesn't throw a network error.
      // console.log('Location sent successfully (no-cors assumed)');
      toast({
          title: "Location Sent",
          description: `Data sent to ${baseUrl}`,
      });

    } catch (error) {
      console.error("Failed to send location:", error);
      const errMsg = error instanceof Error ? error.message : 'Unknown network error';
      setErrorMessage(`Failed to send location: ${errMsg}. Check server URL and network.`);
      setStatusMessage("Error Sending");
       toast({
          title: "Send Error",
          description: `Failed to send data: ${errMsg}`,
          variant: "destructive",
      });
    }
  }, [deviceId, serverUrl, toast]); // Added toast to dependency array

  const handleTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
        setErrorMessage("Geolocation is not supported by this browser.");
        setIsTracking(false);
        setStatusMessage("GPS Not Supported");
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
         toast({
            title: "GPS Not Supported",
            description: "Geolocation is not supported by this browser.",
            variant: "destructive",
        });
        return; // Exit early if geolocation is not available
    }

    // Define error handler function separately
    const handleGeoError = (error: GeolocationPositionError) => {
        console.error("Error getting location:", error);
        const errMsg = `GPS Error: ${error.message} (Code: ${error.code}). Please enable location services and ensure permissions are granted.`;
        setErrorMessage(errMsg);
        setIsTracking(false); // Stop tracking if location fetch fails
        setStatusMessage("GPS Error");
        if (intervalIdRef.current) clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
         toast({
            title: "GPS Error",
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

  }, [sendLocationData, toast]); // Added toast to dependency array

  const startTracking = useCallback(() => {
    // Validation checks
    if (!deviceId || !serverUrl) {
      setErrorMessage("Device ID and Server URL must be configured before starting.");
      toast({
        title: "Configuration Missing",
        description: "Please enter Device ID and Server URL.",
        variant: "destructive",
      });
      return;
    }
     if (!Number.isInteger(intervalSeconds) || intervalSeconds <= 0) {
      setErrorMessage("Interval must be a positive whole number of seconds.");
       toast({
        title: "Invalid Interval",
        description: "Tracking interval must be a positive whole number.",
        variant: "destructive",
      });
      return;
    }

    // Check geolocation support again before starting interval
    if (!('geolocation' in navigator)) {
       setErrorMessage("Geolocation is not supported by this browser. Cannot start tracking.");
       toast({
           title: "GPS Not Supported",
           description: "Cannot start tracking without browser geolocation support.",
           variant: "destructive",
       });
       return;
    }


    setIsTracking(true);
    setStatusMessage("Starting...");
    setErrorMessage(null); // Clear any previous errors

    handleTracking(); // Attempt initial send immediately

    // Clear existing interval before setting a new one, just in case
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
    }

    // Set up the interval timer
    intervalIdRef.current = setInterval(handleTracking, intervalSeconds * 1000);

    toast({
        title: "Tracking Started",
        description: `Sending location every ${intervalSeconds} seconds.`,
    });

  }, [deviceId, serverUrl, intervalSeconds, handleTracking, toast]);

  const stopTracking = useCallback(() => {
    setIsTracking(false);
    setStatusMessage("Stopped");
    setErrorMessage(null); // Clear errors when stopped
    if (intervalIdRef.current) {
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    }
    toast({
        title: "Tracking Stopped",
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
             title: "Interval Updated",
             description: `Now sending location every ${value} seconds.`,
         });
       }
    } else {
        // Optionally provide feedback for invalid input (e.g., non-integer, zero, negative)
        toast({
            title: "Invalid Interval",
            description: "Interval must be a positive whole number.",
            variant: "destructive",
        });
        // You might want to revert to the previous valid value or keep the NaN state
        // For now, just showing a toast. The startTracking function will prevent starting with NaN.
    }
  };


  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md shadow-lg rounded-xl border"> {/* Added rounded-xl and border */}
        <CardHeader className="p-6"> {/* Adjusted padding */}
          <CardTitle className="text-2xl font-bold text-center text-foreground">Traccar Web Client</CardTitle> {/* Increased boldness */}
          <CardDescription className="text-center text-muted-foreground pt-1">
            Send your browser's location to your Traccar server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6"> {/* Consistent padding */}
          {errorMessage && (
            <Alert variant="destructive" className="rounded-md"> {/* Rounded alert */}
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="deviceId" className="font-medium">Device Identifier</Label>
            <Input
              id="deviceId"
              placeholder="Enter unique device ID"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={isTracking}
              className="bg-card rounded-md shadow-sm" /* Added rounding and shadow */
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="serverUrl" className="font-medium">Traccar Server URL</Label>
            <Input
              id="serverUrl"
              placeholder="http://your-traccar-server:5055"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              disabled={isTracking}
              type="url"
              className="bg-card rounded-md shadow-sm" /* Added rounding and shadow */
            />
             <p className="text-xs text-muted-foreground pt-1">Ensure the URL uses port 5055 (osmand protocol).</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interval" className="font-medium">Tracking Interval (seconds)</Label>
            <Input
              id="interval"
              type="number"
              min="1"
              step="1" // Ensure whole numbers
              value={isNaN(intervalSeconds) ? '' : intervalSeconds} // Show empty string if NaN
              onChange={handleIntervalChange}
              className="bg-card rounded-md shadow-sm" /* Added rounding and shadow */
            />
          </div>

          <div className="flex flex-col items-center space-y-4 pt-2"> {/* Added padding-top */}
             <Button
              onClick={isTracking ? stopTracking : startTracking}
              className={`w-full text-lg py-3 rounded-md shadow-md transition-colors duration-200 ${
                  isTracking
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
               }`}
              aria-label={isTracking ? 'Stop Tracking' : 'Start Tracking'}
              disabled={isTracking ? false : (isNaN(intervalSeconds) || !deviceId || !serverUrl)} // Disable start if config invalid
            >
              {isTracking ? <Square className="mr-2 h-5 w-5" /> : <Play className="mr-2 h-5 w-5" />}
              {isTracking ? 'Stop Tracking' : 'Start Tracking'}
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
       {/* Removed redundant Toaster here, it's already in layout.tsx */}
       {/* <Toaster /> */}
    </div>
  );
};

export default TraccarWebClient;
