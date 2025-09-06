import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import JSZip from 'jszip';

interface ImagePair {
  id: string;
  original: string; // dataURL for preview
  originalFile: File;
  enhanced: string | null;
  isLoading: boolean;
  error: string | null;
  isSelected: boolean;
  title: string;
}

interface CustomSettings {
    angles: {
        front: boolean;
        side: boolean;
        top: boolean;
        threeQuarter: boolean;
        closeUp: boolean;
        back: boolean;
    };
    background: 'velvet' | 'marble' | 'abstract' | 'whiteStudio' | 'gradient';
    lighting: 'soft' | 'dramatic' | 'natural' | 'highKey' | 'shadowed';
    outputFormat: 'jpeg' | 'png' | 'webp';
}

const defaultCustomSettings: CustomSettings = {
    angles: { front: true, side: false, top: false, threeQuarter: false, closeUp: false, back: false },
    background: 'velvet',
    lighting: 'soft',
    outputFormat: 'jpeg',
};

const App: React.FC = () => {
  const [imagePairs, setImagePairs] = useState<ImagePair[]>([]);
  const [likedImages, setLikedImages] = useState<ImagePair[]>([]);
  const [enhancingMode, setEnhancingMode] = useState<'auto' | 'custom' | null>(null);
  const [progress, setProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 0 });
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isCustomModalOpen, setIsCustomModalOpen] = useState<boolean>(false);
  const [isLikedGalleryVisible, setIsLikedGalleryVisible] = useState<boolean>(false);
  const [customSettings, setCustomSettings] = useState<CustomSettings>(defaultCustomSettings);
  const [showClearConfirmModal, setShowClearConfirmModal] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [isDownloadingLiked, setIsDownloadingLiked] = useState<boolean>(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load liked images from localStorage on initial render
  useEffect(() => {
    try {
        const storedLikedImages = localStorage.getItem('likedJewelryImages');
        if (storedLikedImages) {
            setLikedImages(JSON.parse(storedLikedImages));
        }
    } catch (e) {
        console.error("Failed to parse liked images from localStorage", e);
    }
  }, []);

  // Save liked images to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('likedJewelryImages', JSON.stringify(likedImages));
  }, [likedImages]);
  
  // Effect to manage toast message visibility
  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);


  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };
  
  const convertImageFormat = (dataUrl: string, format: 'jpeg' | 'png' | 'webp'): Promise<string> => {
    return new Promise((resolve, reject) => {
        const mimeType = `image/${format}`;
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context'));
            }
            ctx.drawImage(image, 0, 0);
            const newDataUrl = canvas.toDataURL(mimeType, 0.9);
            resolve(newDataUrl);
        };
        image.onerror = () => {
            reject(new Error('Failed to load image for format conversion.'));
        };
        image.src = dataUrl;
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newPairs: ImagePair[] = Array.from(files).map((file, index) => {
       if (!file.type.startsWith('image/')) {
        console.warn(`Skipping non-image file: ${file.name}`);
        return null;
      }
      return {
        id: `${file.name}-${Date.now()}-${index}`,
        original: URL.createObjectURL(file),
        originalFile: file,
        enhanced: null,
        isLoading: false,
        error: null,
        isSelected: false,
        title: `Original View ${imagePairs.length + index + 1}`
      };
    }).filter((pair): pair is ImagePair => pair !== null);
    
    setImagePairs(prev => [...prev, ...newPairs]);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };
  
  const enhanceImageWithRetry = async (
    pair: ImagePair, 
    prompt: string, 
    outputFormat: 'jpeg' | 'png' | 'webp' | undefined,
    ai: GoogleGenAI
  ): Promise<ImagePair> => {
      const MAX_RETRIES = 3;
      const INITIAL_RETRY_DELAY_MS = 1000;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
              const base64ImageData = await fileToBase64(pair.originalFile);
              const response: GenerateContentResponse = await ai.models.generateContent({
                  model: 'gemini-2.5-flash-image-preview',
                  contents: { parts: [{ inlineData: { data: base64ImageData, mimeType: pair.originalFile.type, }}, { text: prompt }] },
                  config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
              });

              let enhancedUrl: string | null = null;
              if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
                  for (const part of response.candidates[0].content.parts) {
                      if (part.inlineData) {
                          enhancedUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                          break;
                      }
                  }
              }
              
              if (enhancedUrl) {
                  let finalUrl = enhancedUrl;
                  if (outputFormat) {
                      finalUrl = await convertImageFormat(enhancedUrl, outputFormat);
                  }
                  return { ...pair, enhanced: finalUrl, isLoading: false, isSelected: true }; // Success!
              } else {
                  throw new Error("AI did not return an image.");
              }
          } catch (err) {
              console.error(`Attempt ${attempt} failed for image ${pair.id}:`, err);
              if (attempt === MAX_RETRIES) {
                  let errorMessage = "An unknown error occurred.";
                  if (err instanceof Error) {
                    if (err.message.includes('429') || err.message.toLowerCase().includes('quota') || err.message.toLowerCase().includes('rate limit')) {
                      errorMessage = "Rate limit exceeded. Please try again later.";
                    } else {
                      errorMessage = err.message;
                    }
                  }
                  return { ...pair, isLoading: false, error: errorMessage };
              }
              // Exponential backoff delay before the next retry
              await new Promise(resolve => setTimeout(resolve, INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1)));
          }
      }
      
      // This line is theoretically unreachable but required for type safety
      return { ...pair, isLoading: false, error: "Enhancement failed after multiple retries." };
  };

  const runEnhancement = async (
    jobs: {pair: ImagePair, prompt: string}[], 
    outputFormat: 'jpeg' | 'png' | 'webp' | undefined,
    onProgress: () => void
  ) => {
     const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
     const BATCH_SIZE = 5; // Process images in small batches to avoid rate limiting
     const allResolvedPairs: ImagePair[] = [];

     for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
        const batchJobs = jobs.slice(i, i + BATCH_SIZE);

        const batchPromises = batchJobs.map(({pair, prompt}) => 
            enhanceImageWithRetry(pair, prompt, outputFormat, ai)
        );

        const resolvedPairsInBatch = await Promise.all(batchPromises);

        allResolvedPairs.push(...resolvedPairsInBatch);
        
        resolvedPairsInBatch.forEach(() => onProgress());
     }

     // Update state only once after all batches are complete for better performance
     setImagePairs(currentPairs => {
        const resolvedMap = new Map(allResolvedPairs.map(p => [p.id, p]));
        return currentPairs.map(p => resolvedMap.get(p.id) || p);
     });
  }

  const handleAutoEnhance = async () => {
    const uploadedPairs = imagePairs.filter(p => !p.enhanced && !p.isLoading);
    if (uploadedPairs.length === 0 || enhancingMode) return;

    setEnhancingMode('auto');
    setProgress({ completed: 0, total: uploadedPairs.length });

    const idsToProcess = new Set(uploadedPairs.map(p => p.id));
    setImagePairs(prev =>
      prev.map(p =>
        idsToProcess.has(p.id) ? { ...p, isLoading: true, error: null } : p
      )
    );

    const basePrompt = `Task: Act as an expert jewelry image retoucher.
    1.  **Inspect and Correct Imperfections:** Identify and remove any scratches, blemishes, dust, or surface flaws on the ornament. The final image must display a flawless, clean, and polished surface, making the jewelry look brand new.
    2.  **Preserve Orientation and Angle:** Maintain the exact perspective and angle of the original photo. The enhanced output must match the orientation and position as seen in the input image. Do not change the camera angle.
    3.  **Accurately Render Material and Gemstones:** Precisely detect and retain the original material and color. If the ornament is silver, produce a realistic silver color. If it's gold, reflect the correct gold hue. For any diamonds or gemstones, enhance their sparkle and clarity so they appear vivid and sharp, but do not change the stone type, color, or cut.
    4.  **Produce a High-Quality Studio-Ready Image:** Enhance the background, lighting, and clarity to professional e-commerce standards. Place the ornament on a clean, luxurious surface (like dark velvet or soft marble) with natural shadows and crisp details. The final image should be visually appealing without altering the essential attributes of the jewelry.`;

    const jobs: {pair: ImagePair, prompt: string}[] = uploadedPairs.map(p => ({ pair: p, prompt: basePrompt }));

    await runEnhancement(jobs, undefined, () => {
        setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
    });

    setEnhancingMode(null);
    setProgress({ completed: 0, total: 0 });

    setImagePairs(currentPairs => 
        currentPairs.map(p => 
            (p.enhanced || p.error) ? { ...p, isLoading: false } : p
        )
    );
  };

  const handleCustomEnhance = async () => {
      setIsCustomModalOpen(false);
      const uploadedPairs = imagePairs.filter(p => !p.enhanced && !p.isLoading);
      if (uploadedPairs.length === 0 || enhancingMode) return;
      
      let prompt = `Task: Enhance a photo of gold jewelry for e-commerce. It must have high clarity and elegance.
      Style requirements:
      `;
      switch (customSettings.lighting) {
          case 'dramatic': prompt += '- Lighting: Use dramatic, bold lighting with high contrast and deep shadows. '; break;
          case 'natural': prompt += '- Lighting: Use clean and natural lighting, like from a soft daylight window. '; break;
          case 'highKey': prompt += '- Lighting: Use high-key lighting for a bright, airy, and shadowless look. '; break;
          case 'shadowed': prompt += '- Lighting: Use specific, directed lighting to create long, artistic shadows. '; break;
          default: prompt += '- Lighting: Use soft, luxurious lighting to highlight shine and texture. '; break;
      }
      switch (customSettings.background) {
          case 'marble': prompt += '- Background: Place the jewelry on a clean white or black marble surface. '; break;
          case 'abstract': prompt += '- Background: Place the jewelry on a minimal, abstract, out-of-focus background. '; break;
          case 'whiteStudio': prompt += '- Background: Place the jewelry against a seamless, pure white studio background. '; break;
          case 'gradient': prompt += '- Background: Place the jewelry against a subtle, elegant color gradient background. '; break;
          default: prompt += '- Background: Place the jewelry on a rich, dark velvet cloth. '; break;
      }

      let jobs: {pair: ImagePair, prompt: string}[] = [];
      const newGeneratedPairs: ImagePair[] = [];

      // Add jobs to enhance the originally uploaded images if 'Front View' is checked
      if (customSettings.angles.front) {
          uploadedPairs.forEach(p => jobs.push({ pair: p, prompt }));
      }

      const anglePrompts = {
          side: "generate a realistic side view of the jewelry",
          top: "generate a realistic top-down view of the jewelry",
          threeQuarter: "generate a realistic 3/4 three-quarter view of the jewelry",
          closeUp: "generate a detailed close-up macro shot of the jewelry, focusing on craftsmanship",
          back: "generate a realistic back view of the jewelry"
      };
      
      // Generate new angles for EACH uploaded image
      uploadedPairs.forEach(sourcePair => {
          (Object.keys(anglePrompts) as (keyof typeof anglePrompts)[]).forEach(angle => {
              const angleKey = angle as keyof CustomSettings['angles'];
              if (customSettings.angles[angleKey]) {
                  const title = `Generated ${angle.charAt(0).toUpperCase() + angle.slice(1)} View`;
                  const newPair: ImagePair = { 
                      ...sourcePair, 
                      id: `${sourcePair.id}-gen-${angle}`, 
                      title, 
                      isLoading: true, 
                      enhanced: null, 
                      error: null, 
                      isSelected: false 
                  };
                  newGeneratedPairs.push(newPair);
                  jobs.push({ pair: newPair, prompt: `Based on the provided image, ${anglePrompts[angle]}. Then, enhance this newly generated view using these style requirements: ${prompt}`});
              }
          });
      });

      if (jobs.length === 0) {
        setToastMessage("No enhancements or angles selected.");
        return;
      }

      setEnhancingMode('custom');
      setProgress({ completed: 0, total: jobs.length });
      
      const idsToProcess = new Set(jobs.map(j => j.pair.id));
      const pairsWithLoading = imagePairs.map(p => idsToProcess.has(p.id) ? {...p, isLoading: true, error: null} : p);
      
      setImagePairs([...pairsWithLoading.filter(p => !p.id.includes('-gen-')), ...newGeneratedPairs]);
      
      await runEnhancement(jobs, customSettings.outputFormat, () => {
          setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
      });
      
      setEnhancingMode(null);
      setProgress({ completed: 0, total: 0 });
      
      setImagePairs(currentPairs => 
        currentPairs.map(p => 
            (p.enhanced || p.error) ? { ...p, isLoading: false } : p
        )
    );
  }
  
  const handleRemoveImage = (id: string) => {
    setImagePairs(prev => prev.filter(p => p.id !== id));
  };

  const handleClearSession = () => {
    setShowClearConfirmModal(true);
  };
  
  const executeClearSession = () => {
    // Clear all data
    setImagePairs([]);
    setLikedImages([]); // This will also clear localStorage via the useEffect
    
    // Reset settings
    setCustomSettings(defaultCustomSettings);
    
    // Reset process states
    setEnhancingMode(null);
    setProgress({ completed: 0, total: 0 });

    // Reset UI visibility and states
    setIsLikedGalleryVisible(false);
    setIsCustomModalOpen(false);
    closeCamera();

    setShowClearConfirmModal(false);

    // Provide user feedback
    setToastMessage("Session cleared successfully.");
  };

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setToastMessage("Camera access is not supported by this browser.");
      return;
    }
    
    if (!videoRef.current) {
        console.error("Camera modal is not rendered correctly. videoRef is null.");
        setToastMessage("An internal error occurred. Please refresh the page.");
        return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      if (videoDevices.length === 0) {
        setToastMessage("No camera found on this device.");
        return;
      }

      let stream: MediaStream | null = null;
      let lastError: Error | null = null;

      const constraints: MediaStreamConstraints[] = [
        { video: { facingMode: 'environment' } },
        { video: { facingMode: 'user' } },
        { video: true }
      ];

      for (const constraint of constraints) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraint);
          if (stream) {
            lastError = null; 
            break; 
          }
        } catch (err) {
          lastError = err as Error;
          console.warn(`Failed to get stream with constraint: ${JSON.stringify(constraint)}`, err);
        }
      }

      if (stream && videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraOpen(true);
      } else {
        throw lastError || new Error("Unable to acquire a camera stream after multiple attempts.");
      }

    } catch (err) {
      console.error("Final error while trying to access camera:", err);
      if (err instanceof Error) {
        switch (err.name) {
          case 'NotAllowedError':
          case 'PermissionDeniedError':
            setToastMessage("Camera access denied. Please enable it in browser settings.");
            break;
          case 'NotFoundError':
          case 'DevicesNotFoundError':
             setToastMessage("No compatible camera found on this device.");
            break;
          case 'NotReadableError':
          case 'OverconstrainedError':
             setToastMessage("Camera is in use by another application or hardware error occurred.");
             break;
          default:
             setToastMessage(`Camera error: ${err.name}. Please check permissions.`);
             break;
        }
      } else {
        setToastMessage("An unknown error occurred while accessing the camera.");
      }
    }
  };

  const closeCamera = () => {
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
    }
    setIsCameraOpen(false);
  };
  
  const handleCapture = async () => {
    if (videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext('2d');
        if (context) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg');
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
            
            const newPair: ImagePair = {
              id: `${file.name}-${Date.now()}`,
              original: dataUrl,
              originalFile: file,
              enhanced: null,
              isLoading: false,
              error: null,
              isSelected: false,
              title: 'Original View'
            };
            setImagePairs(prev => [...prev, newPair]);
        }
        closeCamera();
    }
  };
  
  const handleToggleSelection = (id: string) => {
    setImagePairs(prev =>
      prev.map(p => (p.id === id ? { ...p, isSelected: !p.isSelected } : p))
    );
  };
  
  const handleDownloadSelected = async () => {
    const selectedImages = imagePairs.filter(p => p.isSelected && p.enhanced);
    if (selectedImages.length === 0 || isDownloading) return;

    setIsDownloading(true);
    try {
        const zip = new JSZip();
        
        const getExtensionFromMimeType = (mimeType: string): string => {
            switch (mimeType) {
                case 'image/png': return 'png';
                case 'image/webp': return 'webp';
                case 'image/jpeg':
                default: return 'jpg';
            }
        };

        selectedImages.forEach((pair, index) => {
          const dataUrlParts = pair.enhanced!.split(',');
          const mimeTypePart = dataUrlParts[0].match(/:(.*?);/);
          const mimeType = mimeTypePart ? mimeTypePart[1] : 'image/jpeg';
          const fileExtension = getExtensionFromMimeType(mimeType);
          const base64Data = dataUrlParts[1];
          
          zip.file(`enhanced-jewelry-${index + 1}.${fileExtension}`, base64Data, { base64: true });
        });

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = 'enhanced-jewelry.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Failed to create zip:", error);
        setToastMessage("Failed to download images.");
    } finally {
        setIsDownloading(false);
    }
  };
  
  const handleDownloadSelectedLiked = async () => {
    const selectedLikedImages = likedImages.filter(p => p.isSelected && p.enhanced);
    if (selectedLikedImages.length === 0 || isDownloadingLiked) return;

    setIsDownloadingLiked(true);
    try {
        const zip = new JSZip();
        
        const getExtensionFromMimeType = (mimeType: string): string => {
            switch (mimeType) {
                case 'image/png': return 'png';
                case 'image/webp': return 'webp';
                case 'image/jpeg':
                default: return 'jpg';
            }
        };

        selectedLikedImages.forEach((pair, index) => {
          const dataUrlParts = pair.enhanced!.split(',');
          const mimeTypePart = dataUrlParts[0].match(/:(.*?);/);
          const mimeType = mimeTypePart ? mimeTypePart[1] : 'image/jpeg';
          const fileExtension = getExtensionFromMimeType(mimeType);
          const base64Data = dataUrlParts[1];
          
          zip.file(`liked-jewelry-${index + 1}.${fileExtension}`, base64Data, { base64: true });
        });

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = 'liked-jewelry.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Failed to create zip for liked images:", error);
        setToastMessage("Failed to download liked images.");
    } finally {
        setIsDownloadingLiked(false);
    }
  };

  const handleZoom = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const img = container.querySelector('img');
    if (!img) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    img.style.transformOrigin = `${(x / rect.width) * 100}% ${(y / rect.height) * 100}%`;
  };

  const handleZoomExit = (e: React.MouseEvent<HTMLDivElement>) => {
      const img = e.currentTarget.querySelector('img');
      if (img) img.style.transformOrigin = 'center center';
  };

  const handleToggleLike = (pairToToggle: ImagePair) => {
    setLikedImages(currentLiked => {
        const isAlreadyLiked = currentLiked.some(p => p.id === pairToToggle.id);
        if (isAlreadyLiked) {
            return currentLiked.filter(p => p.id !== pairToToggle.id);
        } else {
            // Add to liked, but reset selection state for the liked context
            return [...currentLiked, { ...pairToToggle, isSelected: false }];
        }
    });
  };

  const handleToggleLikedSelection = (id: string) => {
    setLikedImages(prev =>
      prev.map(p => (p.id === id ? { ...p, isSelected: !p.isSelected } : p))
    );
  };

  const selectedCount = imagePairs.filter(p => p.isSelected).length;
  const selectedLikedCount = likedImages.filter(p => p.isSelected).length;
  const unenhancedCount = imagePairs.filter(p => !p.enhanced && !p.isLoading).length;
  
  const autoEnhanceText = enhancingMode === 'auto' 
    ? `Enhancing (${progress.completed}/${progress.total})`
    : '✨ Auto Enhance';
  const customEnhanceText = enhancingMode === 'custom' 
    ? `Enhancing (${progress.completed}/${progress.total})`
    : '🎨 Custom Enhance';

  return (
    <div className="container">
      {toastMessage && (
        <div className="toast-notification" role="status">
          {toastMessage}
        </div>
      )}

      {showClearConfirmModal && (
        <div className="confirm-modal-overlay">
            <div className="confirm-modal-content" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
                <h2 id="confirm-modal-title">Confirm Clear Session</h2>
                <p>Are you sure you want to clear this session? All uploaded images, enhanced results, and liked items will be permanently removed.</p>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={() => setShowClearConfirmModal(false)}>Cancel</button>
                    <button className="btn btn-danger" onClick={executeClearSession}>Clear Session</button>
                </div>
            </div>
        </div>
      )}

      <div className="camera-modal" role="dialog" aria-modal="true" style={{display: isCameraOpen ? 'flex' : 'none'}}>
        <div className="camera-container">
          <video ref={videoRef} autoPlay playsInline className="camera-feed"></video>
          <canvas ref={canvasRef} style={{ display: 'none' }}></canvas>
          <div className="camera-controls">
            <button className="btn btn-secondary" onClick={closeCamera}>Close</button>
            <button className="btn btn-capture" onClick={handleCapture}>Capture</button>
          </div>
        </div>
      </div>

      {isCustomModalOpen && (
        <div className="custom-modal-overlay" onClick={() => setIsCustomModalOpen(false)}>
            <div className="custom-modal-content" onClick={e => e.stopPropagation()}>
                <h2>Customize Your Enhancement</h2>
                <fieldset>
                    <legend>Choose Angles</legend>
                    <small>Enhance uploaded views and generate any additional selected angles.</small>
                     <div className="checkbox-group">
                        <label>
                            <input type="checkbox" checked={customSettings.angles.front} onChange={e => setCustomSettings(s => ({...s, angles: {...s.angles, front: e.target.checked}}))} />
                            Front View
                        </label>
                        <label>
                            <input type="checkbox" checked={customSettings.angles.side} onChange={e => setCustomSettings(s => ({...s, angles: {...s.angles, side: e.target.checked}}))} />
                            Side View
                        </label>
                        <label>
                            <input type="checkbox" checked={customSettings.angles.top} onChange={e => setCustomSettings(s => ({...s, angles: {...s.angles, top: e.target.checked}}))} />
                            Top View
                        </label>
                        <label>
                            <input type="checkbox" checked={customSettings.angles.threeQuarter} onChange={e => setCustomSettings(s => ({...s, angles: {...s.angles, threeQuarter: e.target.checked}}))} />
                            3/4 View
                        </label>
                        <label>
                            <input type="checkbox" checked={customSettings.angles.closeUp} onChange={e => setCustomSettings(s => ({...s, angles: {...s.angles, closeUp: e.target.checked}}))} />
                            Close-Up
                        </label>
                         <label>
                            <input type="checkbox" checked={customSettings.angles.back} onChange={e => setCustomSettings(s => ({...s, angles: {...s.angles, back: e.target.checked}}))} />
                            Back View
                        </label>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>Select Background</legend>
                    <div className="radio-group">
                        <label><input type="radio" name="background" value="velvet" checked={customSettings.background === 'velvet'} onChange={e => setCustomSettings(s => ({...s, background: e.target.value as any}))} /> Velvet</label>
                        <label><input type="radio" name="background" value="marble" checked={customSettings.background === 'marble'} onChange={e => setCustomSettings(s => ({...s, background: e.target.value as any}))} /> Marble</label>
                        <label><input type="radio" name="background" value="abstract" checked={customSettings.background === 'abstract'} onChange={e => setCustomSettings(s => ({...s, background: e.target.value as any}))} /> Abstract</label>
                        <label><input type="radio" name="background" value="whiteStudio" checked={customSettings.background === 'whiteStudio'} onChange={e => setCustomSettings(s => ({...s, background: e.target.value as any}))} /> White Studio</label>
                        <label><input type="radio" name="background" value="gradient" checked={customSettings.background === 'gradient'} onChange={e => setCustomSettings(s => ({...s, background: e.target.value as any}))} /> Gradient</label>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>Choose Lighting</legend>
                    <div className="radio-group">
                        <label><input type="radio" name="lighting" value="soft" checked={customSettings.lighting === 'soft'} onChange={e => setCustomSettings(s => ({...s, lighting: e.target.value as any}))} /> Soft</label>
                        <label><input type="radio" name="lighting" value="dramatic" checked={customSettings.lighting === 'dramatic'} onChange={e => setCustomSettings(s => ({...s, lighting: e.target.value as any}))} /> Dramatic</label>
                        <label><input type="radio" name="lighting" value="natural" checked={customSettings.lighting === 'natural'} onChange={e => setCustomSettings(s => ({...s, lighting: e.target.value as any}))} /> Natural</label>
                        <label><input type="radio" name="lighting" value="highKey" checked={customSettings.lighting === 'highKey'} onChange={e => setCustomSettings(s => ({...s, lighting: e.target.value as any}))} /> High-Key</label>
                        <label><input type="radio" name="lighting" value="shadowed" checked={customSettings.lighting === 'shadowed'} onChange={e => setCustomSettings(s => ({...s, lighting: e.target.value as any}))} /> Shadowed</label>
                    </div>
                </fieldset>
                <fieldset>
                    <legend>Output Format</legend>
                    <div className="radio-group">
                        <label><input type="radio" name="format" value="jpeg" checked={customSettings.outputFormat === 'jpeg'} onChange={e => setCustomSettings(s => ({...s, outputFormat: e.target.value as any}))} /> JPEG</label>
                        <label><input type="radio" name="format" value="png" checked={customSettings.outputFormat === 'png'} onChange={e => setCustomSettings(s => ({...s, outputFormat: e.target.value as any}))} /> PNG</label>
                        <label><input type="radio" name="format" value="webp" checked={customSettings.outputFormat === 'webp'} onChange={e => setCustomSettings(s => ({...s, outputFormat: e.target.value as any}))} /> WEBP</label>
                    </div>
                </fieldset>
                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={() => setIsCustomModalOpen(false)}>Cancel</button>
                    <button className="btn btn-secondary" onClick={() => setCustomSettings(defaultCustomSettings)}>Reset</button>
                    <button className="btn btn-primary" onClick={handleCustomEnhance} disabled={unenhancedCount === 0 || !!enhancingMode}>Continue</button>
                </div>
            </div>
        </div>
      )}

      <header>
        <h1>Jewelry Photo Enhancer</h1>
        <p>Upload or capture photos of your jewelry and let our AI transform them into stunning, professional studio-quality images for your shop.</p>
      </header>

      <div className="controls">
        <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>Upload Photos</button>
        <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/png, image/jpeg, image/webp" style={{ display: 'none' }} multiple />
        <button className="btn btn-secondary" onClick={openCamera}>Take Photo</button>
        <button className="btn btn-primary" onClick={handleAutoEnhance} disabled={unenhancedCount === 0 || !!enhancingMode}>
          {autoEnhanceText}
        </button>
         <button className="btn btn-primary" onClick={() => setIsCustomModalOpen(true)} disabled={unenhancedCount === 0 || !!enhancingMode}>
          {customEnhanceText}
        </button>
        <button className="btn btn-download" onClick={handleDownloadSelected} disabled={selectedCount === 0 || isDownloading}>
          {isDownloading ? (
            <>
              <span className="btn-spinner" role="status" aria-hidden="true"></span>
              Preparing...
            </>
          ) : `Download Selected (${selectedCount})`}
        </button>
        <button className="btn btn-danger" onClick={handleClearSession} disabled={imagePairs.length === 0 && likedImages.length === 0}>Clear Session</button>
        <button className="btn btn-secondary" onClick={() => setIsLikedGalleryVisible(v => !v)}>
            {isLikedGalleryVisible ? 'Hide Liked' : `My Liked Images (${likedImages.length})`}
        </button>
      </div>
      
      {isLikedGalleryVisible && (
        <div className="liked-gallery-section">
            <h2>My Liked Images</h2>
            {likedImages.length > 0 && (
                <div className="liked-gallery-controls">
                    <button 
                        className="btn btn-download" 
                        onClick={handleDownloadSelectedLiked} 
                        disabled={selectedLikedCount === 0 || isDownloadingLiked}>
                        {isDownloadingLiked ? (
                          <>
                            <span className="btn-spinner" role="status" aria-hidden="true"></span>
                            Preparing...
                          </>
                        ) : `Download Selected (${selectedLikedCount})`}
                    </button>
                </div>
            )}
            {likedImages.length === 0 ? (
                <p className="empty-liked-message">You haven't liked any images yet. Click the heart icon on an enhanced image to save it here.</p>
            ) : (
                <div className="liked-gallery">
                {likedImages.map(pair => (
                    <div className="image-card liked-card" key={`liked-${pair.id}`}>
                        <button className="btn-like liked" onClick={() => handleToggleLike(pair)} aria-label="Unlike this image">❤️</button>
                        <div className="image-placeholder enhanced-zoom" onMouseMove={handleZoom} onMouseLeave={handleZoomExit}>
                            <img src={pair.enhanced!} alt={`AI Enhanced ${pair.title}`} />
                        </div>
                        {pair.enhanced && (
                            <div className="selection-control">
                                <input 
                                    type="checkbox" 
                                    id={`select-liked-${pair.id}`} 
                                    checked={pair.isSelected} 
                                    onChange={() => handleToggleLikedSelection(pair.id)} 
                                />
                                <label htmlFor={`select-liked-${pair.id}`}>Select to Download</label>
                            </div>
                        )}
                    </div>
                ))}
                </div>
            )}
        </div>
      )}

      <div className="enhancement-gallery">
        {imagePairs.length === 0 && !isLikedGalleryVisible && (
          <div className="empty-state">
            <h2>Your Jewelry Gallery Awaits</h2>
            <p>Upload or take photos to begin the transformation.</p>
          </div>
        )}
        {imagePairs.map(pair => (
          <div className="enhancement-pair" key={pair.id}>
            <div className="image-card">
              <h2>{pair.title}</h2>
               <button className="btn-remove" onClick={() => handleRemoveImage(pair.id)} aria-label={`Remove ${pair.title}`}>&times;</button>
              <div className="image-placeholder">
                <img src={pair.original} alt={`Original ${pair.title}`} />
              </div>
            </div>
            <div className="image-card">
              <h2>Enhanced</h2>
              {pair.enhanced && (
                 <button 
                    className={`btn-like ${likedImages.some(p => p.id === pair.id) ? 'liked' : ''}`} 
                    onClick={() => handleToggleLike(pair)} 
                    aria-label="Like this image">
                    {likedImages.some(p => p.id === pair.id) ? '❤️' : '🤍'}
                </button>
              )}
              <div className="image-placeholder enhanced-zoom" aria-live="polite" onMouseMove={pair.enhanced ? handleZoom : undefined} onMouseLeave={pair.enhanced ? handleZoomExit : undefined}>
                {pair.isLoading && (
                  <div className="loading-state-container" aria-label="Loading enhanced image">
                    <p className="loading-text">Pls hold your images on the way</p>
                  </div>
                )}
                {pair.error && <div className="error-message" role="alert">{pair.error}</div>}
                {pair.enhanced && <img src={pair.enhanced} alt={`AI Enhanced ${pair.title}`} />}
                {!pair.isLoading && !pair.enhanced && !pair.error && <span>Enhanced image will appear here</span>}
              </div>
              {pair.enhanced && (
                <div className="selection-control">
                  <input type="checkbox" id={`select-${pair.id}`} checked={pair.isSelected} onChange={() => handleToggleSelection(pair.id)} />
                  <label htmlFor={`select-${pair.id}`}>Select to Download</label>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);