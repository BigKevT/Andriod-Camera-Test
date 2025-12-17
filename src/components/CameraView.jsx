import React, { useRef, useState, useEffect, useCallback } from 'react';
import './CameraView.css';
import { isLowLight, applyFilters } from '../utils/imageUtils';

const CameraView = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [facingMode, setFacingMode] = useState('environment');
  const [capturedImage, setCapturedImage] = useState(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  // New state for Zoom and Focus
  const [zoom, setZoom] = useState(1);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 1 });
  const [showZoom, setShowZoom] = useState(false);
  const [focusPoint, setFocusPoint] = useState(null); // {x, y} for animation

  const streamRef = useRef(null);

  const startCamera = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTorchSupported(false);
    setShowZoom(false);

    // Cleanup previous stream immediately
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    try {
      // 1. Request maximum resolution with 4:3 aspect ratio
      // Note: Samsung devices ignore focusMode/focusDistance constraints
      // We rely on native autofocus instead
      const constraints = {
        video: {
          facingMode: facingMode,
          aspectRatio: { ideal: 4 / 3 },
          width: { ideal: 4032, min: 1920 },
          height: { ideal: 3024, min: 1440 }
        },
        audio: false
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);
      streamRef.current = newStream;

      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
      }

      const track = newStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};

      // Log capabilities for debugging (especially useful for Samsung devices)
      console.log('Camera capabilities:', {
        focusMode: capabilities.focusMode,
        focusDistance: capabilities.focusDistance,
        zoom: capabilities.zoom ? `${capabilities.zoom.min}-${capabilities.zoom.max}` : 'not supported',
        torch: capabilities.torch || false
      });

      if (capabilities.torch) setTorchSupported(true);

      // 2. Setup zoom if supported (keep at 1.0x for best quality)
      if (capabilities.zoom) {
        setZoomRange({
          min: capabilities.zoom.min,
          max: capabilities.zoom.max
        });

        const sweetSpotZoom = 1.0;

        if (track.applyConstraints) {
          try {
            await track.applyConstraints({ advanced: [{ zoom: sweetSpotZoom }] });
            setZoom(sweetSpotZoom);
            setShowZoom(true);
          } catch (e) {
            console.warn("Failed to apply zoom:", e);
            setZoom(1.0);
          }
        }
      }

      // Note: Manual focus constraints (focusMode, focusDistance) are removed
      // because they don't work on Samsung devices (S21+, Note20, etc.)
      // We rely on the device's native autofocus instead

      setLoading(false);
    } catch (err) {
      console.error("Error accessing camera:", err);
      setError(`無法存取相機 (${err.name}: ${err.message})。`);
      setLoading(false);
    }
  }, [facingMode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]); // Added stream to dependency array for cleanup logic

  const handleZoomChange = async (e) => {
    const newZoom = parseFloat(e.target.value);
    setZoom(newZoom);

    if (stream) {
      const track = stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({
          advanced: [{ zoom: newZoom }]
        });
      } catch (err) {
        console.error("Zoom failed:", err);
      }
    }
  };

  const handleTapToFocus = async (e) => {
    // 1. Show animation at tap location
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setFocusPoint({ x, y });
    setTimeout(() => setFocusPoint(null), 1000); // Hide after animation

    // 2. Trigger re-focus logic
    if (stream) {
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};

      try {
        // Strategy: Toggle focus mode or slightly adjust zoom to force ISP to re-evaluate
        // Note: 'focusMode' isn't always supported in applyConstraints for all browsers
        if (capabilities.focusMode && capabilities.focusMode.includes('macro')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'macro' }] });
          await new Promise(r => setTimeout(r, 200));
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous-picture' }] });
        } else {
          // Fallback: slight zoom wiggle if zoom is supported
          if (showZoom) {
            const currentZoom = zoom;
            const wiggleZoom = Math.min(currentZoom + 0.1, zoomRange.max);
            await track.applyConstraints({ advanced: [{ zoom: wiggleZoom }] });
            await new Promise(r => setTimeout(r, 100));
            await track.applyConstraints({ advanced: [{ zoom: currentZoom }] });
          } else {
            // Just re-apply continuous-picture
            await track.applyConstraints({ advanced: [{ focusMode: 'continuous-picture' }] });
          }
        }
      } catch (err) {
        console.warn("Focus trigger failed:", err);
      }
    }
  };

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
      const lowLight = isLowLight(videoRef.current);
      if (lowLight && torchSupported) {
        await setTorch(true);
        await new Promise(r => setTimeout(r, 300));
      }

      // Give autofocus time to settle (especially important for Samsung devices)
      await new Promise(r => setTimeout(r, 300));

      setIsFlashing(true);
      setTimeout(() => setIsFlashing(false), 300);

      const video = videoRef.current;
      const canvas = canvasRef.current;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext('2d');

      // 5. 高品質渲染設定
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      if (facingMode === 'user') {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      if (lowLight && torchSupported) {
        await setTorch(false);
      }

      // 5. JPEG 品質 0.98 (接近無損)
      const rawImageDataUrl = canvas.toDataURL('image/jpeg', 0.98);

      // 4. Image post-processing: increased sharpening to compensate for autofocus
      const processedImage = await applyFilters(rawImageDataUrl, {
        sharpen: 0.7,  // Increased from 0.5 for better edge definition
        contrast: 1.2,
        brightness: 20,
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

      {/* Video Preview with Tap to Focus */}
      <div className="video-wrapper" onClick={handleTapToFocus}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`camera-video ${facingMode === 'environment' ? 'back-camera' : ''}`}
        />
        {focusPoint && (
          <div
            className="focus-ring"
            style={{ top: focusPoint.y, left: focusPoint.x }}
          />
        )}
      </div>



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
