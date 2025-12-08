import React, { useRef, useState, useEffect, useCallback } from 'react';
import './CameraView.css';
import { isLowLight, applyFilters } from '../utils/imageUtils';

const CameraView = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [facingMode, setFacingMode] = useState('environment'); // Default to back camera for OCR
  const [capturedImage, setCapturedImage] = useState(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const startCamera = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTorchSupported(false);

    // Stop existing stream if any
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    try {
      // Advanced constraints for OCR
      const constraints = {
        video: {
          facingMode: facingMode,
          // Request 4:3 aspect ratio (e.g., 4032x3024)
          aspectRatio: { ideal: 4 / 3 },
          width: { ideal: 4032 },
          height: { ideal: 3024 },
          // Advanced modes (may not be supported by all browsers)
          focusMode: 'continuous-picture',
          exposureMode: 'continuous-auto',
          whiteBalanceMode: 'single-shot'
        },
        audio: false
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }

      // Check for torch support
      const track = newStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities();
      if (capabilities.torch) {
        setTorchSupported(true);
      }

      // Apply advanced settings if supported
      if (track.applyConstraints) {
        try {
          await track.applyConstraints({
            advanced: [{
              focusMode: 'continuous-picture',
              exposureMode: 'continuous-auto',
              exposureCompensation: 0,
              meteringMode: 'center-weighted',
              whiteBalanceMode: 'auto'
            }]
          });
        } catch (e) {
          console.warn("Advanced constraints not fully supported:", e);
        }
      }

      setLoading(false);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError("無法存取相機。請確保您已允許相機權限。(Unable to access camera. Please ensure you have granted camera permissions.)");
      setLoading(false);
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  const switchCamera = () => {
    setFacingMode(prevMode => prevMode === 'user' ? 'environment' : 'user');
  };

  const setTorch = async (on) => {
    if (stream && torchSupported) {
      const track = stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({
          advanced: [{ torch: on }]
        });
      } catch (e) {
        console.error("Failed to set torch:", e);
      }
    }
  };

  const captureStrategy = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setProcessing(true);

    try {
      // Step A: Check Low Light & Enable Torch
      const lowLight = isLowLight(videoRef.current);
      if (lowLight && torchSupported) {
        await setTorch(true);
        // Wait for light to stabilize
        await new Promise(r => setTimeout(r, 300));
      }

      // Step B: Trigger Focus (Simulated)
      // Since we can't manually trigger focus point in Web API easily,
      // we rely on the continuous focus we set earlier.
      // We wait a bit to ensure focus is settled, especially if we just turned on the light.
      await new Promise(r => setTimeout(r, 400));

      // Step C: Capture
      setIsFlashing(true);
      setTimeout(() => setIsFlashing(false), 300);

      const video = videoRef.current;
      const canvas = canvasRef.current;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext('2d');

      if (facingMode === 'user') {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Turn off torch immediately after capture
      if (lowLight && torchSupported) {
        await setTorch(false);
      }

      // Step D: Post-processing (OCR Optimization)
      const rawImageDataUrl = canvas.toDataURL('image/jpeg', 0.95);

      const processedImage = await applyFilters(rawImageDataUrl, {
        sharpen: 0.5,
        contrast: 1.1,
        brightness: 0,
        grayscale: true
      });

      setCapturedImage(processedImage);

    } catch (e) {
      console.error("Capture failed:", e);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="camera-container">
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div className={`flash-effect ${isFlashing ? 'flash-animation' : ''}`} />

      {loading && <div className="loading-spinner" />}

      {processing && (
        <div className="processing-overlay">
          <div className="loading-spinner" />
          <p>Processing...</p>
        </div>
      )}

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={startCamera} style={{ marginTop: '10px' }}>重試 (Retry)</button>
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`camera-video ${facingMode === 'environment' ? 'back-camera' : ''}`}
      />

      <div className="camera-overlay">
        <div className="control-btn" style={{ opacity: capturedImage ? 1 : 0, pointerEvents: capturedImage ? 'auto' : 'none' }}>
          {capturedImage && (
            <div className="captured-preview">
              <img src={capturedImage} alt="Captured" />
            </div>
          )}
        </div>

        <button
          className="capture-btn-outer"
          onClick={captureStrategy}
          disabled={processing}
          aria-label="Capture photo"
        >
          <div className="capture-btn-inner" />
        </button>

        <button className="control-btn" onClick={switchCamera} aria-label="Switch camera">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" />
            <path d="M15 11v4" />
            <path d="M19 13v-2" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default CameraView;
