#!/usr/bin/env python3
"""
Perspective Analysis Plotter

Reads output.json and creates a scatter plot of bias_x vs significance_y
with a color spectrum gradient from red to violet on the x-axis.
"""

import json
import os
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
import pandas as pd


def load_output_data(output_path: str):
    """Load perspective data from output.json file."""
    try:
        with open(output_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data.get('perspectives', [])
    except FileNotFoundError:
        print(f"Error: Output file not found at {output_path}")
        return []
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in output file: {e}")
        return []


def plot_perspective_analysis(perspectives, output_path=None):
    """Create a scatter plot with discrete rainbow bands and vertical separators."""
    if not perspectives:
        print("No perspective data to plot")
        return

    df = pd.DataFrame(perspectives)

    # Define rainbow bands
    bands = [
        (0.0, 1/6, 'Red', '#FF0000'),
        (1/6, 2/6, 'Orange', '#FF8000'),
        (2/6, 3/6, 'Yellow', '#FFFF00'),
        (3/6, 4/6, 'Green', '#00FF00'),
        (4/6, 5/6, 'Blue', '#0000FF'),
        (5/6, 1.0, 'Indigo/Violet', '#8B00FF')
    ]

    # Assign color by band
    def get_band_color(x):
        for start, end, name, color in bands:
            if start <= x < end or (end == 1.0 and x == 1.0):
                return color
        return '#888888'
    df['band_color'] = df['bias_x'].apply(get_band_color)

    # Create scatter plot
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df['bias_x'],
        y=df['significance_y'],
        mode='markers',
        marker=dict(
            color=df['band_color'],
            size=12,
            line=dict(width=1, color='black')
        ),
        text=[f"Bias: {x:.2f}<br>Significance: {y:.2f}" for x, y in zip(df['bias_x'], df['significance_y'])],
        hoverinfo='text',
        name='Perspectives'
    ))

    # Add colored bands as rectangles
    for start, end, name, color in bands:
        fig.add_shape(
            type='rect',
            x0=start, x1=end, y0=0, y1=1,
            fillcolor=color,
            opacity=0.15,
            line=dict(width=0),
            layer='below'
        )
        # Add vertical separator
        if start > 0:
            fig.add_shape(
                type='line',
                x0=start, x1=start, y0=0, y1=1,
                line=dict(color='black', width=2, dash='dot'),
                layer='below'
            )

    # Add color labels
    for start, end, name, color in bands:
        xpos = (start + end) / 2
        fig.add_annotation(
            x=xpos, y=-0.08, text=name,
            showarrow=False,
            font=dict(color=color, size=12, family='Arial'),
            xanchor='center', yanchor='top',
            bgcolor='white',
        )

    fig.update_layout(
        xaxis=dict(
            title='Bias Position (0.0 = Red/Strong A, 1.0 = Violet/Strong B)',
            range=[0, 1],
            showgrid=False
        ),
        yaxis=dict(
            title='Significance (significance_y)',
            range=[0, 1],
            showgrid=True
        ),
        title='Perspective Analysis: Bias vs Significance',
        title_x=0.5,
        margin=dict(l=60, r=40, t=60, b=80),
        height=600,
        width=1000,
        plot_bgcolor='white',
        showlegend=False
    )

    # Save or show the plot
    if output_path:
        fig.write_image(output_path)
        print(f"Plot saved to: {output_path}")
    else:
        fig.show()


def main():
    """Main function to run the perspective analysis plotter."""
    # Find output.json in the parent directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.dirname(script_dir)
    output_file = os.path.join(parent_dir, 'output.json')

    print("Perspective Analysis Plotter")
    print("=" * 40)
    print(f"Loading data from: {output_file}")

    # Load the data
    perspectives = load_output_data(output_file)

    if not perspectives:
        print("No data found. Please run the perspective generation first.")
        return

    print(f"Loaded {len(perspectives)} perspectives")

    # Create plot
    plot_path = os.path.join(parent_dir, 'perspective_analysis.png')
    plot_perspective_analysis(perspectives, plot_path)


if __name__ == "__main__":
    main()