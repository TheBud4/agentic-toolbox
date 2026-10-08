#!/usr/bin/env python3
"""Sintetiza os sons do mod: sounds/roleta.wav, sounds/jackpot.wav e sounds/notificacao.wav.

Tudo gerado do zero (sem amostras de terceiros). Rode de novo para regerar:
    python3 tools/gerar-sons.py
"""
import math
import os
import random
import struct
import wave

RATE = 44100
random.seed(7)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'sounds')


def blank(seconds):
    return [0.0] * int(seconds * RATE)


def add(buf, start, samples, gain=1.0):
    i0 = int(start * RATE)
    for i, s in enumerate(samples):
        j = i0 + i
        if j >= len(buf):
            break
        buf[j] += s * gain


def tick(freq, length=0.018, decay=260.0):
    """Clique seco da bolinha batendo nos defletores: senoide amortecida + ruído."""
    n = int(length * RATE)
    out = []
    for i in range(n):
        t = i / RATE
        env = math.exp(-decay * t)
        tone = math.sin(2 * math.pi * freq * t) + 0.5 * math.sin(2 * math.pi * freq * 2.7 * t)
        out.append(env * (0.7 * tone + 0.6 * (random.random() * 2 - 1)))
    return out


def chip(freq, length, duty=0.25):
    """Nota 8-bit (onda quadrada estreita) com envelope curto."""
    n = int(length * RATE)
    period = RATE / freq
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, t * 300) * math.exp(-2.5 * t)
        out.append(env * (1.0 if (i % period) / period < duty else -1.0))
    return out


def whir(seconds, start_hz=38.0, end_hz=9.0):
    """Ronco do prato girando: ruído grave modulado pela rotação, perdendo velocidade."""
    n = int(seconds * RATE)
    out = []
    lp = 0.0
    phase = 0.0
    for i in range(n):
        p = i / n
        hz = start_hz * (end_hz / start_hz) ** p
        phase += 2 * math.pi * hz / RATE
        lp += 0.04 * ((random.random() * 2 - 1) - lp)
        env = (1 - p) ** 1.6 * min(1.0, i / (0.15 * RATE))
        out.append(lp * env * (0.6 + 0.4 * math.sin(phase)))
    return out


def roleta():
    dur = 5.2
    buf = blank(dur)
    add(buf, 0.0, whir(4.6), 1.6)
    # A bolinha corre rápido e vai desacelerando: intervalo entre cliques cresce.
    t = 0.05
    interval = 0.032
    while t < 4.1:
        add(buf, t, tick(random.uniform(3200, 4200)), random.uniform(0.25, 0.4))
        t += interval * random.uniform(0.9, 1.1)
        interval *= 1.045
    # Sem a bolinha quicando e parando na casa: o giro some no fade-out.
    return buf


def jackpot():
    dur = 2.0
    buf = blank(dur)
    # Fanfarra 8-bit subindo (C maior) e o acorde final soando até sumir.
    notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]
    for k, f in enumerate(notes):
        add(buf, 0.0 + k * 0.09, chip(f, 0.12), 0.18)
    for f in (1046.5, 1318.5, 1568.0):
        add(buf, 0.56, chip(f, 1.44, 0.5), 0.09)
    return buf


# Por som: segundos cortados do final, segundos de fade-out no novo final e
# pico final (1.0 = máximo do arquivo), já com os 70% de volume.
def notificacao():
    """Plim-plim de ficha 8-bit: duas notas curtas subindo, pedindo atenção."""
    buf = blank(0.5)
    add(buf, 0.0, chip(1318.5, 0.09), 0.2)
    add(buf, 0.08, chip(1975.5, 0.4, 0.5), 0.16)
    return buf


SOUNDS = {
    'roleta.wav': {'trim': 1.5, 'fade': 0.8, 'loudness': 0.31},
    'jackpot.wav': {'trim': 0.0, 'fade': 0.4, 'loudness': 0.28},
    'notificacao.wav': {'trim': 0.0, 'fade': 0.15, 'loudness': 0.28},
}


def save(name, buf):
    cfg = SOUNDS[name]
    buf = buf[: len(buf) - int(cfg['trim'] * RATE)]
    peak = max(abs(s) for s in buf) or 1.0
    scale = cfg['loudness'] / peak
    n = len(buf)
    f = int(cfg['fade'] * RATE)
    for i in range(f):
        # Curva quadrática: cai suave, sem o "degrau" de um corte linear.
        buf[n - 1 - i] *= (i / f) ** 2
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s * scale)) * 32767)) for s in buf))
    print(f'{path}: {n / RATE:.1f}s')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    save('roleta.wav', roleta())
    save('jackpot.wav', jackpot())
    save('notificacao.wav', notificacao())
