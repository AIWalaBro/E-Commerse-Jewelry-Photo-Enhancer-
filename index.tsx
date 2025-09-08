import React, { useState, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, GenerateContentResponse } from "@google/genai";
import JSZip from 'jszip';

interface ImagePair {
  id: string;
  sourceId: string; // ID of the original uploaded image
  original: string; // dataURL for preview
  originalFile: File;
  enhanced: string | null;
  isLoading: boolean;
  error: string | null;
  isSelected: boolean;
  title: string;
  enhancedTitle?: string;
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
    material: 'auto' | 'gold' | 'silver' | 'platinum';
    outputFormat: 'jpeg' | 'png' | 'webp';
}

const defaultCustomSettings: CustomSettings = {
    angles: { front: true, side: false, top: false, threeQuarter: false, closeUp: false, back: false },
    background: 'velvet',
    lighting: 'soft',
    material: 'auto',
    outputFormat: 'jpeg',
};

const App: React.FC = () => {
  const [imagePairs, setImagePairs] = useState<ImagePair[]>([]);
  const [imageCounter, setImageCounter] = useState<number>(1);
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

  const getOrnamentType = async (imageFile: File): Promise<string> => {
    const MAX_RETRIES = 3;
    const INITIAL_RETRY_DELAY_MS = 1000;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! }); // Initialize once outside loop

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const base64ImageData = await fileToBase64(imageFile);
            const prompt = "Analyze this image of a jewelry item. Briefly describe its main subject or shape (e.g., 'Snake', 'Flower', 'Solitaire'). Respond with only the one or two most descriptive words, capitalized.";
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: { parts: [{ inlineData: { data: base64ImageData, mimeType: imageFile.type } }, { text: prompt }] },
                config: { thinkingConfig: { thinkingBudget: 0 } }
            });
            
            const ornamentType = response.text.trim().replace(/[^a-zA-Z\s]/g, ''); // Sanitize
            
            if (ornamentType && ornamentType.length > 2 && ornamentType.length < 25) {
                return ornamentType; // Success!
            }
            // If we get a valid response but it's not a good ornament name, don't retry.
            // Just fall back gracefully. The API didn't error out.
            console.warn(`AI returned an unusual ornament type: "${ornamentType}". Using fallback.`);
            return "Jewelry";

        } catch (error) {
            console.error(`Attempt ${attempt} failed to identify ornament type:`, error);
            if (attempt === MAX_RETRIES) {
                console.error("All attempts to identify ornament type failed. Using fallback.");
                // The loop will end, and the final fallback will be returned outside.
                break;
            }
            // Wait with exponential backoff before the next attempt.
            const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return "Jewelry"; // This is the final fallback if all retries fail.
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const currentCounter = imageCounter;
    
    setToastMessage(`Identifying ${files.length} image(s)...`);

    const newPairsPromises = Array.from(files).map(async (file, index) => {
       if (!file.type.startsWith('image/')) {
        console.warn(`Skipping non-image file: ${file.name}`);
        return null;
      }
      const newId = `${file.name}-${Date.now()}-${index}`;
      const ornamentType = await getOrnamentType(file);

      return {
        id: newId,
        sourceId: newId,
        original: URL.createObjectURL(file),
        originalFile: file,
        enhanced: null,
        isLoading: false,
        error: null,
        isSelected: false,
        title: `Original ${ornamentType} View ${currentCounter + index}`
      };
    });
    
    const resolvedPairs = await Promise.all(newPairsPromises);
    const newPairs = resolvedPairs.filter((pair): pair is ImagePair => pair !== null);
    
    if (newPairs.length > 0) {
      setImageCounter(currentCounter + newPairs.length);
      setImagePairs(prev => [...prev, ...newPairs]);
      setToastMessage(`${newPairs.length} image(s) added.`);
    } else {
      setToastMessage(''); // Clear loading toast if no valid images
    }
    
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
    const sourceIdsWithResults = new Set(imagePairs.filter(p => p.id !== p.sourceId).map(p => p.sourceId));
    const sourcePairsToProcess = imagePairs.filter(p => p.id === p.sourceId && !sourceIdsWithResults.has(p.id));

    if (sourcePairsToProcess.length === 0 || enhancingMode) return;

    setEnhancingMode('auto');
    setProgress({ completed: 0, total: sourcePairsToProcess.length });

    // const basePrompt = `You are an expert jewelry photo retoucher.
    //  Your task is to enhance the provided image of a jewelry ornament for a high-end e-commerce website. Follow these instructions precisely:
    //  1.  **Completely remove the original background.** Ensure no part of the original background is visible.
    //  2.  Place the jewelry on a new, clean background. Choose either a rich velvet cloth or a marble surface, whichever best suits the item.
    //  3.  Apply soft, luxurious lighting to highlight shine and texture.
    //  4.  Add subtle reflections and shadows for realism.
    //  The final image must have high clarity and elegance, suitable for a professional e-commerce display.
    // `;

    const basePrompt =`You are a world-class jewelry photo retoucher specializing in high-end e-commerce presentation.

  Your task is to transform the provided image of a jewelry ornament into a visually stunning, premium-quality product photo. Follow these instructions with meticulous attention to detail:

  1. **Remove the original background entirely.** No trace of the original setting should remain.
  2. **Replace the background** with one of the following:
    - A deep, rich velvet cloth in black, royal blue, or burgundy.
    - A polished marble surface in white or soft grey tones.
    Choose the option that best complements the jewelry’s material and color.
  3. **Apply soft, diffused lighting** to accentuate the brilliance, texture, and craftsmanship of the piece. Avoid harsh shadows or overexposure.
  4. **Add elegant, realistic shadows and subtle reflections** beneath the jewelry to enhance depth and dimensionality.
  5. Ensure the final image has **exceptional clarity, refined contrast, and a luxurious finish**—suitable for a premium e-commerce storefront or luxury catalog.

  The result should evoke sophistication, trust, and desire—inviting the viewer to appreciate the artistry and value of the jewelry.`;
    
    const newResultPairs: ImagePair[] = [];
    const jobs: {pair: ImagePair, prompt: string}[] = [];

    sourcePairsToProcess.forEach(sourcePair => {
      const newPair: ImagePair = {
        ...sourcePair,
        id: `${sourcePair.id}-res-auto`,
        sourceId: sourcePair.id,
        enhancedTitle: 'Enhanced',
        isLoading: true,
        enhanced: null,
        error: null,
        isSelected: false,
      };
      newResultPairs.push(newPair);
      jobs.push({ pair: newPair, prompt: basePrompt });
    });

    if (jobs.length === 0) {
      setEnhancingMode(null);
      return;
    }

    setImagePairs(currentPairs => [...currentPairs, ...newResultPairs]);

    await runEnhancement(jobs, undefined, () => {
        setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
    });

    setEnhancingMode(null);
    setProgress({ completed: 0, total: 0 });
  };

  const handleCustomEnhance = async () => {
      setIsCustomModalOpen(false);
      const sourceIdsWithResults = new Set(imagePairs.filter(p => p.id !== p.sourceId).map(p => p.sourceId));
      const sourcePairs = imagePairs.filter(p => p.id === p.sourceId && !sourceIdsWithResults.has(p.id));

      if (sourcePairs.length === 0 || enhancingMode) return;

      let baseTask = '';
      if (customSettings.material === 'auto') {
          baseTask = `Task: Enhance this jewelry photo for e-commerce. The ornament’s material and color should be faithfully preserved as seen in the image.`;
      } else {
          baseTask = `Task: Transform the jewelry in the provided photo to be made of high-quality, polished ${customSettings.material}. Faithfully preserve the exact physical structure, dimensions, and design details of the ornament, but change its material. Realistically render the new ${customSettings.material} material.`;
      }
      
      let backgroundInstruction = '';
      switch (customSettings.background) {
          case 'marble': backgroundInstruction = 'Place the jewelry on a clean white or black marble surface.'; break;
          case 'abstract': backgroundInstruction = 'Place the jewelry on a minimal, abstract, out-of-focus background.'; break;
          case 'whiteStudio': backgroundInstruction = 'Place the jewelry against a seamless, pure white studio background.'; break;
          case 'gradient': backgroundInstruction = 'Place the jewelry against a subtle, elegant color gradient background.'; break;
          default: backgroundInstruction = 'Place the jewelry on a rich, dark velvet cloth.'; break;
      }
      
      let lightingInstruction = '';
       switch (customSettings.lighting) {
          case 'dramatic': lightingInstruction = 'Use dramatic, bold lighting with high contrast and deep shadows.'; break;
          case 'natural': lightingInstruction = 'Use clean and natural lighting, like from a soft daylight window.'; break;
          case 'highKey': lightingInstruction = 'Use high-key lighting for a bright, airy, and shadowless look.'; break;
          case 'shadowed': lightingInstruction = 'Use specific, directed lighting to create long, artistic shadows.'; break;
          default: lightingInstruction = 'Use soft, luxurious lighting to highlight shine and texture.'; break;
      }

      const stylePrompt = `
        **Primary Goal:** First and most importantly, completely remove the original background. Isolate the jewelry perfectly, then place it onto a new background as described. Ensure no part of the original background is visible.

        ${baseTask}
        
        **Style requirements:**
        - Background: ${backgroundInstruction}
        - Lighting: ${lightingInstruction}
        
        The final output must have high clarity, flawless presentation, and elegant studio quality.`;
      
      const jobs: {pair: ImagePair, prompt: string}[] = [];
      const newResultPairs: ImagePair[] = [];

      const anglePrompts = {
        side: "Task: Re-render the jewelry from a realistic side-view camera angle. You must preserve the exact physical structure, dimensions, materials, and design details visible in the original. **Do not invent complex details or add markings that are not suggested by the original object.** The goal is a photorealistic, believable change in perspective of the *same object*.",
        top: "Task: Re-render the jewelry from a realistic top-down camera angle (bird's-eye view). You must preserve the exact physical structure, dimensions, materials, and design details visible in the original. **Do not invent complex details or add markings that are not suggested by the original object.** The goal is a photorealistic, believable change in perspective of the *same object*.",
        threeQuarter: "Task: Re-render the jewelry from a realistic three-quarter (3/4) camera angle. You must preserve the exact physical structure, dimensions, materials, and design details visible in the original. **Do not invent complex details or add markings that are not suggested by the original object.** The goal is a photorealistic, believable change in perspective of the *same object*.",
        closeUp: "Task: Generate a detailed close-up macro shot of the jewelry, focusing on a key area of craftsmanship. You must preserve the exact physical structure, materials, and design details of the ornament shown in the original image. **Do not change the object's shape or invent details.** The goal is a photorealistic zoomed-in view of the *same object*.",
        back: "Task: Re-render the jewelry from a realistic back-view camera angle. You must preserve the exact physical structure, dimensions, materials, and design details visible in the original. When inferring the appearance of the back, create a simple and plausible design that is consistent with the front. **Do not invent complex details or add markings that are not suggested by the original object.** The goal is a photorealistic, believable change in perspective of the *same object*."
      };

      const allAngleKeys = ['front', ...Object.keys(anglePrompts)] as const;

      sourcePairs.forEach(sourcePair => {
          const anglesToGenerate = allAngleKeys.filter(angle => customSettings.angles[angle as keyof typeof customSettings.angles]);
          
          if (anglesToGenerate.length === 0) return;

          anglesToGenerate.forEach(angle => {
              let enhancedTitle = '';
              let finalPrompt = '';

              if (angle === 'front') {
                  enhancedTitle = 'Enhanced Front View';
                  finalPrompt = stylePrompt;
              } else {
                  enhancedTitle = `Generated ${angle.charAt(0).toUpperCase() + angle.slice(1).replace(/([A-Z])/g, ' $1')} View`;
                  finalPrompt = `Based on the provided image, ${anglePrompts[angle as keyof typeof anglePrompts]}. Then, enhance this newly generated view using these style requirements:\n${stylePrompt}`;
              }

              const newPair: ImagePair = {
                  ...sourcePair,
                  id: `${sourcePair.id}-res-${angle}`, // Unique ID for this result
                  sourceId: sourcePair.id,
                  enhancedTitle: enhancedTitle,
                  isLoading: true,
                  enhanced: null,
                  error: null,
                  isSelected: false,
              };
              newResultPairs.push(newPair);
              jobs.push({ pair: newPair, prompt: finalPrompt });
          });
      });


      if (jobs.length === 0) {
        setToastMessage("No enhancements or angles selected.");
        return;
      }

      setEnhancingMode('custom');
      setProgress({ completed: 0, total: jobs.length });
      
      setImagePairs(currentPairs => [
          ...currentPairs,
          ...newResultPairs
      ]);
      
      await runEnhancement(jobs, customSettings.outputFormat, () => {
          setProgress(prev => ({ ...prev, completed: prev.completed + 1 }));
      });
      
      setEnhancingMode(null);
      setProgress({ completed: 0, total: 0 });
  }
  
  const handleRemoveImage = (id: string) => {
    setImagePairs(prev => prev.filter(p => p.id !== id));
  };
  
  const handleRemoveGroup = (sourceId: string) => {
      setImagePairs(prev => prev.filter(p => p.sourceId !== sourceId));
  };

  const handleClearSession = () => {
    setShowClearConfirmModal(true);
  };
  
  const executeClearSession = () => {
    // Clear all data
    setImagePairs([]);
    setLikedImages([]); // This will also clear localStorage via the useEffect
    setImageCounter(1);
    
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
            
            closeCamera();
            setToastMessage('Identifying captured image...');

            const ornamentType = await getOrnamentType(file);
            
            const newId = `${file.name}-${Date.now()}`;
            const newPair: ImagePair = {
              id: newId,
              sourceId: newId,
              original: dataUrl,
              originalFile: file,
              enhanced: null,
              isLoading: false,
              error: null,
              isSelected: false,
              title: `Original ${ornamentType} View ${imageCounter}`
            };
            setImagePairs(prev => [...prev, newPair]);
            setImageCounter(prev => prev + 1);
            setToastMessage('Image added.');
        } else {
          closeCamera();
        }
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
  
  const groupedPairs = imagePairs.reduce((acc, pair) => {
      if (!acc[pair.sourceId]) {
          acc[pair.sourceId] = [];
      }
      acc[pair.sourceId].push(pair);
      return acc;
  }, {} as Record<string, ImagePair[]>);

  const selectedCount = imagePairs.filter(p => p.isSelected).length;
  const selectedLikedCount = likedImages.filter(p => p.isSelected).length;
  
  const sourceIdsWithResults = new Set(imagePairs.filter(p => p.id !== p.sourceId).map(p => p.sourceId));
  const unenhancedCount = imagePairs.filter(p => p.id === p.sourceId && !sourceIdsWithResults.has(p.id)).length;
  
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
                    <legend>Material Transformation</legend>
                    <div className="checkbox-group">
                        <label>
                            <input type="radio" name="material" value="auto" checked={customSettings.material === 'auto'} onChange={e => setCustomSettings(s => ({...s, material: e.target.value as any}))} />
                            Auto-detect (Keep Original)
                        </label>
                         <label>
                            <input type="radio" name="material" value="gold" checked={customSettings.material === 'gold'} onChange={e => setCustomSettings(s => ({...s, material: e.target.value as any}))} />
                            Gold
                        </label>
                         <label>
                            <input type="radio" name="material" value="silver" checked={customSettings.material === 'silver'} onChange={e => setCustomSettings(s => ({...s, material: e.target.value as any}))} />
                            Silver
                        </label>
                         <label>
                            <input type="radio" name="material" value="platinum" checked={customSettings.material === 'platinum'} onChange={e => setCustomSettings(s => ({...s, material: e.target.value as any}))} />
                            Platinum
                        </label>
                    </div>
                </fieldset>
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
        {Object.values(groupedPairs).map(group => {
            if (group.length === 0) return null;
            
            const sourceImage = group.find(p => p.id === p.sourceId);
            const resultImages = group.filter(p => p.id !== p.sourceId);

            if (!sourceImage) return null;

            return (
                <div className="enhancement-group" key={sourceImage.sourceId}>
                    <div className="image-card">
                        <h2>{sourceImage.title}</h2>
                        <button className="btn-remove" onClick={() => handleRemoveGroup(sourceImage.sourceId)} aria-label={`Remove ${sourceImage.title} and all its results`}>&times;</button>
                        <div className="image-placeholder enhanced-zoom" onMouseMove={handleZoom} onMouseLeave={handleZoomExit}>
                            <img src={sourceImage.original} alt={`Original ${sourceImage.title}`} />
                        </div>
                    </div>
                    <div className="enhanced-results-grid">
                        {resultImages.length === 0 && (
                             <div className="image-card">
                                <h2>Enhanced</h2>
                                <div className="image-placeholder">
                                    <div className="loading-state-container">
                                        <p className="placeholder-text">Enhanced image will appear here</p>
                                    </div>
                                </div>
                            </div>
                        )}
                        {resultImages.map(pair => (
                            <div className="image-card" key={pair.id}>
                                <h2>{pair.enhancedTitle || 'Enhanced'}</h2>
                                {pair.enhanced && (
                                    <button 
                                        className={`btn-like ${likedImages.some(p => p.id === pair.id) ? 'liked' : ''}`} 
                                        onClick={() => handleToggleLike(pair)} 
                                        aria-label="Like this image">
                                        {likedImages.some(p => p.id === pair.id) ? '❤️' : '🤍'}
                                    </button>
                                )}
                                <button className="btn-remove" onClick={() => handleRemoveImage(pair.id)} aria-label={`Remove ${pair.enhancedTitle || 'this result'}`}>&times;</button>
                                <div className="image-placeholder enhanced-zoom" aria-live="polite" onMouseMove={pair.enhanced ? handleZoom : undefined} onMouseLeave={pair.enhanced ? handleZoomExit : undefined}>
                                    {pair.isLoading && (
                                    <div className="loading-state-container" aria-label="Loading enhanced image">
                                        <p className="loading-text">Pls hold your images on the way</p>
                                    </div>
                                    )}
                                    {pair.error && <div className="error-message" role="alert">{pair.error}</div>}
                                    {pair.enhanced && <img src={pair.enhanced} alt={`AI Enhanced ${pair.title}`} />}
                                </div>
                                {pair.enhanced && (
                                    <div className="selection-control">
                                    <input type="checkbox" id={`select-${pair.id}`} checked={pair.isSelected} onChange={() => handleToggleSelection(pair.id)} />
                                    <label htmlFor={`select-${pair.id}`}>Select to Download</label>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            );
        })}
      </div>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);