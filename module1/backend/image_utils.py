"""
Image validation and processing utilities for serverless deployment.
Optimized for Vercel/GCP Cloud Run with size and format constraints.
"""
import base64
import io
import logging
from typing import Dict, Any, Optional, Tuple
from PIL import Image
import httpx

logger = logging.getLogger(__name__)

MAX_IMAGE_SIZE_MB = 4
MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
MAX_DIMENSION = 4096

async def validate_and_process_image_url(image_url: str) -> Dict[str, Any]:
    """
    Download and validate image from URL.
    Returns base64 encoded image data and metadata.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(image_url, follow_redirects=True)
            
            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"Failed to download image: HTTP {response.status_code}"
                }
            
            content_type = response.headers.get("content-type", "")
            if not content_type.startswith("image/"):
                return {
                    "success": False,
                    "error": f"URL does not point to an image: {content_type}"
                }
            
            image_bytes = response.content
            
            if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
                return {
                    "success": False,
                    "error": f"Image too large: {len(image_bytes) / 1024 / 1024:.2f}MB (max {MAX_IMAGE_SIZE_MB}MB)"
                }
            
            processed = await process_image_bytes(image_bytes)
            if not processed["success"]:
                return processed
            
            return {
                "success": True,
                "base64_data": processed["base64_data"],
                "format": processed["format"],
                "size": processed["size"],
                "dimensions": processed["dimensions"],
                "source": "url"
            }
    
    except httpx.TimeoutException:
        return {"success": False, "error": "Image download timeout"}
    except Exception as e:
        logger.error(f"Error downloading image: {e}")
        return {"success": False, "error": f"Failed to download image: {str(e)}"}


async def process_image_bytes(image_bytes: bytes) -> Dict[str, Any]:
    """
    Process raw image bytes: validate, resize if needed, convert to base64.
    Optimized for serverless environments.
    """
    try:
        img = Image.open(io.BytesIO(image_bytes))
        
        if img.format not in SUPPORTED_FORMATS:
            return {
                "success": False,
                "error": f"Unsupported image format: {img.format}. Supported: {', '.join(SUPPORTED_FORMATS)}"
            }
        
        original_format = img.format
        width, height = img.size
        
        if width > MAX_DIMENSION or height > MAX_DIMENSION:
            ratio = min(MAX_DIMENSION / width, MAX_DIMENSION / height)
            new_size = (int(width * ratio), int(height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
            logger.info(f"Resized image from {width}x{height} to {new_size[0]}x{new_size[1]}")
            width, height = new_size
        
        output = io.BytesIO()
        save_format = "JPEG" if original_format == "JPEG" else "PNG"
        
        if img.mode in ("RGBA", "LA", "P"):
            if save_format == "JPEG":
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
                img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")
        
        quality = 85 if save_format == "JPEG" else None
        img.save(output, format=save_format, quality=quality, optimize=True)
        
        processed_bytes = output.getvalue()
        
        if len(processed_bytes) > MAX_IMAGE_SIZE_BYTES:
            quality = 70
            output = io.BytesIO()
            img.save(output, format="JPEG", quality=quality, optimize=True)
            processed_bytes = output.getvalue()
            
            if len(processed_bytes) > MAX_IMAGE_SIZE_BYTES:
                return {
                    "success": False,
                    "error": f"Image still too large after compression: {len(processed_bytes) / 1024 / 1024:.2f}MB"
                }
        
        base64_data = base64.b64encode(processed_bytes).decode('utf-8')
        
        return {
            "success": True,
            "base64_data": base64_data,
            "format": save_format,
            "size": len(processed_bytes),
            "dimensions": (width, height)
        }
    
    except Exception as e:
        logger.error(f"Error processing image: {e}")
        return {"success": False, "error": f"Failed to process image: {str(e)}"}


def validate_base64_image(base64_string: str) -> Dict[str, Any]:
    """
    Validate base64 encoded image string.
    """
    try:
        if ',' in base64_string:
            base64_string = base64_string.split(',', 1)[1]
        
        image_bytes = base64.b64decode(base64_string)
        
        if len(image_bytes) > MAX_IMAGE_SIZE_BYTES:
            return {
                "valid": False,
                "error": f"Image too large: {len(image_bytes) / 1024 / 1024:.2f}MB (max {MAX_IMAGE_SIZE_MB}MB)"
            }
        
        img = Image.open(io.BytesIO(image_bytes))
        
        if img.format not in SUPPORTED_FORMATS:
            return {
                "valid": False,
                "error": f"Unsupported format: {img.format}"
            }
        
        return {
            "valid": True,
            "format": img.format,
            "size": len(image_bytes),
            "dimensions": img.size
        }
    
    except Exception as e:
        return {"valid": False, "error": f"Invalid base64 image: {str(e)}"}


def get_image_mime_type(format: str) -> str:
    """
    Get MIME type for image format.
    """
    mime_types = {
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "WEBP": "image/webp",
        "GIF": "image/gif"
    }
    return mime_types.get(format, "image/jpeg")
