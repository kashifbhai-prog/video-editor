import { ACCEPT_ATTRIBUTE } from './mediaValidation';

/** Opens the native file picker and resolves with the chosen files. */
export function openFilePicker(accept = ACCEPT_ATTRIBUTE, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
