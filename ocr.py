import pytesseract
from PIL import Image
import sys

img_path = sys.argv[1]
text = pytesseract.image_to_string(Image.open(img_path))
print(text)
