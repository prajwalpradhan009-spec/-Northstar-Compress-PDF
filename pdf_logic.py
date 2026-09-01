from pathlib import Path

try:
    import pypdf as pdf_module
except ImportError:
    import PyPDF2 as pdf_module

from PIL import Image, UnidentifiedImageError


IMAGE_FORMATS = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
    "BMP": ".bmp",
    "TIFF": ".tiff",
}


def merge_pdfs(pdf_list, output_filename="Merged_Document.pdf", output_dir=None):
    if not pdf_list:
        return False, "No files selected."

    destination_dir = Path(output_dir) if output_dir else Path(pdf_list[0]).parent
    destination_dir.mkdir(parents=True, exist_ok=True)
    output_path = destination_dir / output_filename
    merger = pdf_module.PdfMerger()

    try:
        for pdf in pdf_list:
            source_path = Path(pdf)
            if not source_path.exists():
                return False, f"File not found: {source_path}"
            merger.append(str(source_path))

        with output_path.open("wb") as output_file:
            merger.write(output_file)
        return True, f"Merged PDF saved to:\n{output_path}"
    except Exception as error:
        return False, f"Could not merge PDFs: {error}"
    finally:
        merger.close()


def convert_image(image_path, output_format="JPEG", quality=82, output_dir=None):
    """Convert one image and return a success flag plus a user-facing message."""
    source_path = Path(image_path)
    output_format = output_format.upper()
    if output_format not in IMAGE_FORMATS:
        return False, f"Unsupported format: {output_format}"
    if not source_path.exists():
        return False, f"File not found: {source_path}"

    destination_dir = Path(output_dir) if output_dir else source_path.parent
    destination_dir.mkdir(parents=True, exist_ok=True)
    output_path = destination_dir / f"{source_path.stem}_converted{IMAGE_FORMATS[output_format]}"

    try:
        with Image.open(source_path) as image:
            save_image = image.copy()
            if output_format == "JPEG" and save_image.mode not in ("RGB", "L"):
                if save_image.mode in ("RGBA", "LA") or (save_image.mode == "P" and "transparency" in save_image.info):
                    save_image = save_image.convert("RGBA")
                    background = Image.new("RGB", save_image.size, (255, 255, 255))
                    if "A" in save_image.getbands():
                        background.paste(save_image, mask=save_image.getchannel("A"))
                    else:
                        background.paste(save_image)
                    save_image.close()
                    save_image = background
                else:
                    save_image = save_image.convert("RGB")

            save_options = {"format": output_format}
            if output_format in ("JPEG", "WEBP"):
                save_options.update(quality=max(1, min(100, int(quality))), optimize=True)
            elif output_format == "PNG":
                save_options["optimize"] = True
            save_image.save(output_path, **save_options)
            save_image.close()
        return True, str(output_path)
    except (UnidentifiedImageError, OSError) as error:
        return False, f"Could not process {source_path.name}: {error}"


def compress_image(image_path, quality=72, output_dir=None):
    """Create a smaller JPEG copy of an image."""
    return convert_image(image_path, "JPEG", quality, output_dir)