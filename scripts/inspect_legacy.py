import os

def inspect_file(filepath):
    print(f"\n========================================\nFile: {filepath}\n========================================")
    if not os.path.exists(filepath):
        print("File does not exist.")
        return
    try:
        with open(filepath, 'rb') as f:
            data = f.read()
        print(f"Size: {len(data)} bytes")
        # Try decoding as cp950 or utf-8, or print hex
        try:
            text = data.decode('cp950', errors='strict')
            print("Decoded as CP950:")
            print(text)
        except Exception:
            try:
                text = data.decode('utf-8', errors='strict')
                print("Decoded as UTF-8:")
                print(text)
            except Exception:
                print("Binary Content (Hex):")
                print(data.hex()[:500])
                print("\nPrintable characters:")
                printable = "".join(chr(b) if 32 <= b < 127 or b in (10, 13) else '.' for b in data)
                print(printable[:500])
    except Exception as e:
        print(f"Error reading file: {e}")

def main():
    inspect_file(r"E:\SC\RegiBrw.Set")
    inspect_file(r"E:\SC\DoctBrw.Set")
    inspect_file(r"E:\SC\Sc.ini")

if __name__ == '__main__':
    main()
