from PIL import Image, ImageDraw
import sys
code=sys.argv[1]
L=["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"]
G=["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"]
R=["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"]
P=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"]
d=[int(c) for c in code]
bits="101"
for i,c in enumerate(d[1:7]): bits+=(L if P[d[0]][i]=="L" else G)[c]
bits+="01010"
for c in d[7:]: bits+=R[c]
bits+="101"
m=3; W=(len(bits)+20)*m
img=Image.new("RGB",(1600,1200),(235,230,220))
dr=ImageDraw.Draw(img)
x0=600;y0=500
dr.rectangle([x0-40,y0-30,x0+W+40,y0+260],fill="white")
for i,b in enumerate(bits):
    if b=="1": dr.rectangle([x0+(i+10)*m,y0,x0+(i+10)*m+m-1,y0+200],fill="black")
img=img.rotate(4,expand=False,fillcolor=(235,230,220))
img.save(sys.argv[2],quality=85)
