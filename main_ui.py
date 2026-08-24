from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk

import pdf_logic


ctk.set_appearance_mode("dark")
ctk.set_default_color_theme("blue")

COLORS = {
    "background": "#10151c",
    "panel": "#171e27",
    "panel_light": "#202a36",
    "panel_hover": "#2a3746",
    "text": "#f4f7fb",
    "muted": "#9aa8b8",
    "accent": "#43c6ac",
    "accent_hover": "#35a88f",
    "blue": "#4c8dff",
    "blue_hover": "#3978df",
}

BUTTON_HEIGHT = 38
BUTTON_RADIUS = 9
SURFACE_RADIUS = 10


class ModernPDFMerger(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Northstar | File Studio")
        self.geometry("900x650")
        self.minsize(760, 560)
        self.configure(fg_color=COLORS["background"])
        self.pdf_files = []
        self.image_files = []
        self.output_directory = ""

        self._build_header()
        self._build_workspace()

    def _build_header(self):
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.pack(fill="x", padx=34, pady=(28, 12))
        ctk.CTkLabel(header, text="NORTHSTAR", text_color=COLORS["accent"],
                     font=ctk.CTkFont(size=12, weight="bold")).pack(anchor="w")
        ctk.CTkLabel(header, text="Your files, beautifully handled.", text_color=COLORS["text"],
                     font=ctk.CTkFont(size=28, weight="bold")).pack(anchor="w", pady=(4, 2))
        ctk.CTkLabel(header, text="Merge PDFs, compress images, and convert formats in a few clicks.",
                     text_color=COLORS["muted"], font=ctk.CTkFont(size=13)).pack(anchor="w")

    def _build_workspace(self):
        self.tabs = ctk.CTkTabview(self, fg_color=COLORS["panel"], corner_radius=SURFACE_RADIUS,
                                   segmented_button_fg_color=COLORS["panel_light"],
                                   segmented_button_selected_color=COLORS["accent"],
                                   segmented_button_selected_hover_color=COLORS["accent_hover"])
        self.tabs.pack(fill="both", expand=True, padx=28, pady=(8, 28))
        self.tabs.add("PDF merger")
        self.tabs.add("Image studio")
        self._build_pdf_tab(self.tabs.tab("PDF merger"))
        self._build_image_tab(self.tabs.tab("Image studio"))

    def _build_pdf_tab(self, tab):
        ctk.CTkLabel(tab, text="Combine documents", text_color=COLORS["text"],
                     font=ctk.CTkFont(size=20, weight="bold")).pack(anchor="w", padx=22, pady=(22, 2))
        ctk.CTkLabel(tab, text="Arrange your PDFs in selection order, then create one clean file.",
                     text_color=COLORS["muted"]).pack(anchor="w", padx=22, pady=(0, 16))
        self.pdf_listbox = ctk.CTkTextbox(tab, height=230, corner_radius=SURFACE_RADIUS,
                          border_width=1, border_color="#2c3a49",
                          fg_color=COLORS["panel_light"],
                                          text_color=COLORS["text"])
        self.pdf_listbox.pack(fill="both", expand=True, padx=22, pady=4)
        self._set_text(self.pdf_listbox, "No PDFs selected yet.\n\nChoose two or more files to begin.")
        controls = ctk.CTkFrame(tab, fg_color="transparent")
        controls.pack(fill="x", padx=22, pady=18)
        ctk.CTkButton(controls, text="Add PDF files", width=140, height=BUTTON_HEIGHT,
                  corner_radius=BUTTON_RADIUS, command=self.select_pdfs).pack(side="left")
        ctk.CTkButton(controls, text="Clear", width=90, height=BUTTON_HEIGHT,
                  corner_radius=BUTTON_RADIUS, fg_color=COLORS["panel_light"],
                  hover_color=COLORS["panel_hover"], command=self.clear_pdfs).pack(side="left", padx=10)
        self.btn_merge = ctk.CTkButton(controls, text="Merge PDFs", width=150, height=BUTTON_HEIGHT,
                           corner_radius=BUTTON_RADIUS, fg_color=COLORS["accent"],
                           hover_color=COLORS["accent_hover"], text_color="#081411",
                                       font=ctk.CTkFont(weight="bold"), command=self.merge_action)
        self.btn_merge.pack(side="right")

    def _build_image_tab(self, tab):
        ctk.CTkLabel(tab, text="Image studio", text_color=COLORS["text"],
                     font=ctk.CTkFont(size=20, weight="bold")).pack(anchor="w", padx=22, pady=(22, 2))
        ctk.CTkLabel(tab, text="Compress a batch or export it to a format that fits your next destination.",
                     text_color=COLORS["muted"]).pack(anchor="w", padx=22, pady=(0, 12))
        self.image_listbox = ctk.CTkTextbox(tab, height=150, corner_radius=SURFACE_RADIUS,
                            border_width=1, border_color="#2c3a49",
                            fg_color=COLORS["panel_light"], text_color=COLORS["text"])
        self.image_listbox.pack(fill="x", padx=22, pady=4)
        self._set_text(self.image_listbox, "No images selected yet.")
        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.pack(fill="x", padx=22, pady=(14, 4))
        ctk.CTkButton(row, text="Choose images", width=140, height=BUTTON_HEIGHT,
                  corner_radius=BUTTON_RADIUS, command=self.select_images).pack(side="left")
        ctk.CTkButton(row, text="Output folder", width=120, height=BUTTON_HEIGHT,
                  corner_radius=BUTTON_RADIUS, fg_color=COLORS["panel_light"],
                  hover_color=COLORS["panel_hover"], command=self.choose_output).pack(side="left", padx=10)
        self.output_label = ctk.CTkLabel(row, text="Same folder as source", text_color=COLORS["muted"])
        self.output_label.pack(side="left")
        settings = ctk.CTkFrame(tab, fg_color=COLORS["panel_light"], corner_radius=SURFACE_RADIUS,
                    border_width=1, border_color="#2c3a49")
        settings.pack(fill="x", padx=22, pady=14)
        ctk.CTkLabel(settings, text="Export format", text_color=COLORS["muted"]).grid(row=0, column=0, padx=16, pady=16)
        self.format_menu = ctk.CTkOptionMenu(settings, width=120, height=BUTTON_HEIGHT,
                             corner_radius=BUTTON_RADIUS,
                             values=["JPEG", "PNG", "WEBP", "BMP", "TIFF"],
                             fg_color=COLORS["blue"], button_color=COLORS["blue"],
                             button_hover_color=COLORS["blue_hover"])
        self.format_menu.grid(row=0, column=1, padx=8, pady=16)
        ctk.CTkLabel(settings, text="Quality", text_color=COLORS["muted"]).grid(row=0, column=2, padx=(24, 8), pady=16)
        self.quality_value = ctk.CTkLabel(settings, text="82", width=30, text_color=COLORS["text"])
        self.quality_value.grid(row=0, column=4, padx=(4, 16), pady=16)
        self.quality_slider = ctk.CTkSlider(settings, from_=10, to=100, number_of_steps=90,
                                           command=self.update_quality, progress_color=COLORS["accent"])
        self.quality_slider.set(82)
        self.quality_slider.grid(row=0, column=3, sticky="ew", padx=8, pady=16)
        settings.grid_columnconfigure(3, weight=1)
        actions = ctk.CTkFrame(tab, fg_color="transparent")
        actions.pack(fill="x", padx=22, pady=(0, 18))
        ctk.CTkButton(actions, text="Compress to JPEG", width=160, height=BUTTON_HEIGHT,
                  corner_radius=BUTTON_RADIUS, command=self.compress_action).pack(side="left")
        ctk.CTkButton(actions, text="Convert images", width=150, height=BUTTON_HEIGHT,
                  corner_radius=BUTTON_RADIUS, fg_color=COLORS["accent"],
                      hover_color=COLORS["accent_hover"], text_color="#081411",
                      font=ctk.CTkFont(weight="bold"), command=self.convert_action).pack(side="right")
        self.image_status = ctk.CTkLabel(tab, text="Ready for export", text_color=COLORS["muted"],
                         anchor="w")
        self.image_status.pack(fill="x", padx=22, pady=(0, 18))

    @staticmethod
    def _set_text(widget, text):
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        widget.configure(state="disabled")

    def select_pdfs(self):
        files = filedialog.askopenfilenames(title="Select PDF files", filetypes=[("PDF files", "*.pdf")])
        if files:
            self.pdf_files.extend(files)
            self._set_text(self.pdf_listbox, "\n".join(f"{index}. {Path(path).name}" for index, path in enumerate(self.pdf_files, 1)))

    def clear_pdfs(self):
        self.pdf_files.clear()
        self._set_text(self.pdf_listbox, "No PDFs selected yet.\n\nChoose two or more files to begin.")

    def merge_action(self):
        if len(self.pdf_files) < 2:
            messagebox.showwarning("More files needed", "Select at least two PDFs to merge.")
            return
        self.btn_merge.configure(text="Merging...", state="disabled")
        self.update_idletasks()
        success, message = pdf_logic.merge_pdfs(self.pdf_files)
        self.btn_merge.configure(text="Merge PDFs", state="normal")
        (messagebox.showinfo if success else messagebox.showerror)("Northstar", message)
        if success:
            self.clear_pdfs()

    def select_images(self):
        files = filedialog.askopenfilenames(title="Select images", filetypes=[("Image files", "*.jpg *.jpeg *.png *.webp *.bmp *.tif *.tiff")])
        if files:
            self.image_files = list(files)
            self._set_text(self.image_listbox, "\n".join(f"{index}. {Path(path).name}" for index, path in enumerate(self.image_files, 1)))

    def choose_output(self):
        directory = filedialog.askdirectory(title="Choose output folder")
        if directory: 
            self.output_directory = directory
            self.output_label.configure(text=Path(directory).name)
            self.image_status.configure(text=f"Output folder: {directory}", text_color=COLORS["accent"])

    def update_quality(self, value):
        self.quality_value.configure(text=str(round(value)))

    def _process_images(self, compressor=False):
        if not self.image_files:
            messagebox.showwarning("No images", "Choose one or more images first.")
            return
        quality = round(self.quality_slider.get())
        results = []
        for image_path in self.image_files:
            if compressor:
                success, result = pdf_logic.compress_image(image_path, quality, self.output_directory)
            else:
                success, result = pdf_logic.convert_image(image_path, self.format_menu.get(), quality, self.output_directory)
            results.append(result if success else f"Error: {result}")
        successful_files = [result for result in results if not result.startswith("Error:")]
        if successful_files:
            saved_folders = sorted({str(Path(result).parent) for result in successful_files})
            folder_text = " | ".join(saved_folders)
            self.image_status.configure(text=f"Saved to: {folder_text}", text_color=COLORS["accent"])
        messagebox.showinfo("Export complete", "Saved files:\n\n" + "\n".join(results))

    def compress_action(self):
        self._process_images(compressor=True)

    def convert_action(self):
        self._process_images()


if __name__ == "__main__":
    ModernPDFMerger().mainloop()