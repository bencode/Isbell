// An image fitted to the page, pinched to zoom and double tapped in and back, as Photos does.

import SwiftUI
import UIKit

struct ZoomImage: UIViewRepresentable {
    let image: UIImage

    func makeUIView(context: Context) -> ZoomView { ZoomView(image: image) }

    func updateUIView(_ view: ZoomView, context: Context) {}
}

final class ZoomView: UIScrollView, UIScrollViewDelegate {
    private let imageView: UIImageView
    /// The size it was last fitted to, fitted again as that changes.
    private var fitted = CGSize.zero

    init(image: UIImage) {
        imageView = UIImageView(image: image)
        super.init(frame: .zero)
        delegate = self
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        addSubview(imageView)
        contentSize = image.size
        let tap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        tap.numberOfTapsRequired = 2
        addGestureRecognizer(tap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not from a coder") }

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.size != fitted, bounds.width > 0, bounds.height > 0 { fit() }
    }

    /// As large as fits, and no larger than it is.
    private func fit() {
        fitted = bounds.size
        let size = imageView.bounds.size
        let scale = min(bounds.width / size.width, bounds.height / size.height, 1)
        minimumZoomScale = scale
        maximumZoomScale = max(scale * 4, 2)
        zoomScale = scale
        center()
    }

    /// Smaller than the page, it sits in the middle of it.
    private func center() {
        let x = max((bounds.width - contentSize.width) / 2, 0)
        let y = max((bounds.height - contentSize.height) / 2, 0)
        contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { center() }

    @objc private func doubleTapped(_ tap: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale {
            setZoomScale(minimumZoomScale, animated: true)
        } else {
            let at = tap.location(in: imageView)
            let scale = min(minimumZoomScale * 2.5, maximumZoomScale)
            let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
            zoom(to: CGRect(x: at.x - size.width / 2, y: at.y - size.height / 2, width: size.width, height: size.height),
                 animated: true)
        }
    }
}
