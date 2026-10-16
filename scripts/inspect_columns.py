import struct

def inspect_set_file(path):
    print(f"\n=== File: {path} ===")
    with open(path, 'rb') as f:
        content = f.read()
    print(f"Total Bytes: {len(content)}")
    print("Decoded (CP950):")
    try:
        text = content.decode('cp950', errors='ignore')
        print(text)
    except Exception as e:
        print(f"Error CP950: {e}")
    print("Hex representation:")
    print(content.hex())
    print("Printable:")
    print("".join(chr(b) if 32 <= b < 127 or b in (10, 13) else f"\\x{b:02x}" for b in content))

inspect_set_file(r"E:\SC\RegiBrw.Set")
inspect_set_file(r"E:\SC\DoctBrw.Set")
