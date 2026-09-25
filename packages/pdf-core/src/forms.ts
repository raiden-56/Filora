import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFRadioGroup,
  PDFDropdown,
  PDFOptionList,
  PDFButton,
  PDFSignature,
  StandardFonts,
  rgb,
} from 'pdf-lib';

export type FormFieldKind =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'optionlist'
  | 'button'
  | 'signature'
  | 'unknown';

export interface FormFieldInfo {
  name: string;
  kind: FormFieldKind;
  value?: string | boolean | string[];
  options?: string[];
  readOnly?: boolean;
  required?: boolean;
  /** Widget positions on pages (1-based page, fractions of page size, origin top-left) */
  widgets: { page: number; x: number; y: number; width: number; height: number }[];
}

export type FormValue = string | boolean | string[];

export interface NewFormField {
  kind: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'date' | 'signature';
  name: string;
  /** 1-based page */
  page: number;
  /** fractions of the page size, origin top-left */
  rect: { x: number; y: number; width: number; height: number };
  options?: string[];
  /** For radio groups: one entry per option, each with its own rect. */
  radioRects?: { x: number; y: number; width: number; height: number }[];
  defaultValue?: FormValue;
  /** For signature: PNG bytes to draw */
  image?: Uint8Array;
  fontSize?: number;
  multiline?: boolean;
}

function kindOf(field: unknown): FormFieldKind {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFOptionList) return 'optionlist';
  if (field instanceof PDFButton) return 'button';
  if (field instanceof PDFSignature) return 'signature';
  return 'unknown';
}

export async function listFormFields(data: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const pages = doc.getPages();
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const out: FormFieldInfo[] = [];
  for (const field of form.getFields()) {
    const kind = kindOf(field);
    const info: FormFieldInfo = { name: field.getName(), kind, widgets: [] };
    try {
      info.readOnly = field.isReadOnly();
      info.required = field.isRequired();
    } catch {
      /* ignore */
    }
    try {
      if (field instanceof PDFTextField) info.value = field.getText() ?? '';
      else if (field instanceof PDFCheckBox) info.value = field.isChecked();
      else if (field instanceof PDFRadioGroup) {
        info.options = field.getOptions();
        info.value = field.getSelected() ?? '';
      } else if (field instanceof PDFDropdown) {
        info.options = field.getOptions();
        info.value = field.getSelected()[0] ?? '';
      } else if (field instanceof PDFOptionList) {
        info.options = field.getOptions();
        info.value = field.getSelected();
      }
    } catch {
      /* ignore value errors */
    }
    try {
      for (const widget of field.acroField.getWidgets()) {
        const rect = widget.getRectangle();
        const pRef = widget.P();
        let pageIndex = pages.findIndex((p) => p.ref === pRef);
        if (pageIndex < 0) {
          // Fallback: find the page whose Annots contain this widget
          pageIndex = pages.findIndex((p) => {
            const annots = p.node.Annots();
            if (!annots) return false;
            for (let i = 0; i < annots.size(); i++) {
              if (annots.get(i) === widget.dict) return true;
              const obj = annots.lookup(i);
              if (obj === widget.dict) return true;
            }
            return false;
          });
        }
        if (pageIndex < 0) pageIndex = 0;
        const page = pages[pageIndex];
        const { width, height } = page.getSize();
        info.widgets.push({
          page: pageIndex + 1,
          x: rect.x / width,
          y: 1 - (rect.y + rect.height) / height,
          width: rect.width / width,
          height: rect.height / height,
        });
      }
    } catch {
      /* ignore widget errors */
    }
    out.push(info);
  }
  return out;
}

export async function fillFormFields(
  data: Uint8Array,
  values: Record<string, FormValue>,
  options: { flatten?: boolean } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue;
    }
    try {
      if (field instanceof PDFTextField) field.setText(value == null ? '' : String(value));
      else if (field instanceof PDFCheckBox) {
        if (value === true || value === 'true' || value === 'on') field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value) field.select(value);
      } else if (field instanceof PDFDropdown) {
        if (typeof value === 'string' && value) {
          if (!field.getOptions().includes(value)) field.addOptions([value]);
          field.select(value);
        }
      } else if (field instanceof PDFOptionList) {
        const vals = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
        field.select(vals);
      }
    } catch {
      /* skip fields that cannot be set */
    }
  }
  try {
    form.updateFieldAppearances(font);
  } catch {
    /* ignore appearance errors */
  }
  if (options.flatten) {
    try {
      form.flatten();
    } catch {
      /* some forms cannot be flattened */
    }
  }
  return doc.save({ useObjectStreams: true });
}

function toPdfRect(
  r: { x: number; y: number; width: number; height: number },
  pw: number,
  ph: number,
) {
  return {
    x: r.x * pw,
    y: ph - (r.y + r.height) * ph,
    width: r.width * pw,
    height: r.height * ph,
  };
}

export async function addFormFields(
  data: Uint8Array,
  fields: NewFormField[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const used = new Set(form.getFields().map((f) => f.getName()));
  const uniqueName = (n: string) => {
    let name = n || 'field';
    let i = 2;
    while (used.has(name)) name = `${n}_${i++}`;
    used.add(name);
    return name;
  };

  for (const f of fields) {
    const page = doc.getPage(f.page - 1);
    const { width: pw, height: ph } = page.getSize();
    const rect = toPdfRect(f.rect, pw, ph);
    const name = uniqueName(f.name);
    switch (f.kind) {
      case 'text':
      case 'date': {
        const tf = form.createTextField(name);
        if (f.multiline) tf.enableMultiline();
        tf.addToPage(page, { ...rect, font, borderWidth: 1, borderColor: rgb(0.6, 0.6, 0.6) });
        tf.setFontSize(f.fontSize ?? 11);
        if (typeof f.defaultValue === 'string') tf.setText(f.defaultValue);
        break;
      }
      case 'checkbox': {
        const cb = form.createCheckBox(name);
        const size = Math.min(rect.width, rect.height);
        cb.addToPage(page, { x: rect.x, y: rect.y, width: size, height: size });
        if (f.defaultValue === true) cb.check();
        break;
      }
      case 'radio': {
        const rg = form.createRadioGroup(name);
        const opts = f.options?.length ? f.options : ['Option 1', 'Option 2'];
        const rects = f.radioRects?.length ? f.radioRects : opts.map((_, i) => ({
          x: f.rect.x,
          y: f.rect.y + (i * f.rect.height) / opts.length,
          width: f.rect.width,
          height: f.rect.height / opts.length,
        }));
        opts.forEach((opt, i) => {
          const r = toPdfRect(rects[i] ?? rects[0], pw, ph);
          const size = Math.min(r.width, r.height);
          rg.addOptionToPage(opt, page, { x: r.x, y: r.y, width: size, height: size });
        });
        if (typeof f.defaultValue === 'string' && opts.includes(f.defaultValue)) rg.select(f.defaultValue);
        break;
      }
      case 'dropdown': {
        const dd = form.createDropdown(name);
        const opts = f.options?.length ? f.options : ['Option 1', 'Option 2'];
        dd.addOptions(opts);
        if (typeof f.defaultValue === 'string' && opts.includes(f.defaultValue)) dd.select(f.defaultValue);
        dd.addToPage(page, { ...rect, font, borderWidth: 1, borderColor: rgb(0.6, 0.6, 0.6) });
        dd.setFontSize(f.fontSize ?? 11);
        break;
      }
      case 'signature': {
        if (f.image) {
          const png = await doc.embedPng(f.image);
          const s = Math.min(rect.width / png.width, rect.height / png.height);
          const w = png.width * s;
          const h = png.height * s;
          page.drawImage(png, { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h });
        } else {
          // Signature line placeholder
          page.drawLine({
            start: { x: rect.x, y: rect.y + 2 },
            end: { x: rect.x + rect.width, y: rect.y + 2 },
            thickness: 1,
            color: rgb(0.3, 0.3, 0.3),
          });
          page.drawText(name, { x: rect.x, y: rect.y - 10, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
        }
        break;
      }
    }
  }
  try {
    form.updateFieldAppearances(font);
  } catch {
    /* ignore */
  }
  return doc.save({ useObjectStreams: true });
}
