"""
GUI application module (.pyw extension — same Python syntax, windowed mode).
"""
import tkinter as tk
from tkinter import messagebox

from utils.logger import Logger
from services.config import load_config


class GUIApp:
    """Main GUI application class."""

    def __init__(self):
        self.logger = Logger("gui_app")
        self.config = load_config()
        self.root = tk.Tk()

    def run(self):
        """Start the GUI event loop."""
        self.logger.info("Starting GUI application")
        self.root.title(self.config.get("app_title", "Aura App"))
        self.root.mainloop()

    def show_message(self, title: str, message: str):
        """Display a message box to the user."""
        messagebox.showinfo(title, message)


def create_app():
    """Factory function to create a GUI app instance."""
    return GUIApp()