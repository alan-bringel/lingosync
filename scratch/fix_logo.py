import sys
import os

path = '/Users/alanbringel/Downloads/lingosync/public/logo-ligosync.svg'
if not os.path.exists(path):
    print(f"Error: {path} not found")
    sys.exit(1)

with open(path, 'r') as f:
    lines = f.readlines()

# Line 1: <svg ...>
# Line 2: <defs>
# Line 3: <image ...>
# Line 4: </defs>
# Line 5: <style>
# Line 6: </style>
# ...

# We keep lines 1 to 4 (index 0 to 3)
header = lines[:4]

# New content based on the original structure but with the new color
new_content = [
    '\t<style>\n',
    '\t\t.s0 { fill: #ffffff }\n',
    '\t\t.s1 { fill: #827367 }\n',
    '\t</style>\n',
    '\t<g id="Layer 1">\n',
    '\t\t<path id="Layer" fill-rule="evenodd" class="s0" d="m470 235c0 129.8-105.2 235-235 235-129.8 0-235-105.2-235-235 0-129.8 105.2-235 235-235 129.8 0 235 105.2 235 235z"/>\n',
    '\t\t<path id="Layer" fill-rule="evenodd" class="s1" d="m338.4 314.1h-206.8v-158.2h206.8zm-103.4-135.4c-52.7 0-95.3 42.6-95.3 95.3h190.6c0-52.7-42.6-95.3-95.3-95.3z"/>\n',
    '\t</g>\n',
    '</svg>\n'
]

with open(path, 'w') as f:
    f.writelines(header + new_content)

print("Successfully updated logo-ligosync.svg with original paths and brown color.")
