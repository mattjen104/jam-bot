import fitz
from pathlib import Path
src = Path('attached_assets/Lore_—_Library_&_Lens-selection_1790089566772.pdf')
out = Path('.agents/outputs/lore-artboard')
out.mkdir(parents=True, exist_ok=True)
doc = fitz.open(src)
print('pages', doc.page_count)
for i, page in enumerate(doc):
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    path = out / f'page-{i+1}.png'
    pix.save(path)
    print(path, page.rect)
