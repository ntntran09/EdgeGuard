#include <iostream>
#include <vector>
#include <string>
#include <iomanip>
#include <algorithm>
#include <opencv2/opencv.hpp>

using namespace cv;
using namespace std;

struct CameraMetrics {
    double meanBrightness;   // Độ sáng trung bình (0 - 255)
    double stdDevContrast;   // Độ tương phản / Độ lệch chuẩn
    double darkPixelRatio;   // Tỷ lệ pixel quá tối (<15) [%]
    double brightPixelRatio; // Tỷ lệ pixel quá sáng (>240) [%]
    double edgeDensity;      // Tỷ lệ mật độ cạnh [%]
};

// Hàm tính toán các chỉ số cơ bản của Frame
CameraMetrics computeMetrics(const Mat& grayFrame) {
    CameraMetrics metrics;
    int totalPixels = grayFrame.rows * grayFrame.cols;

    // a. Mean & StdDev
    Scalar meanVal, stdDevVal;
    meanStdDev(grayFrame, meanVal, stdDevVal);
    metrics.meanBrightness = meanVal[0];
    metrics.stdDevContrast = stdDevVal[0];

    // b. Tỷ lệ Pixel quá tối / quá sáng
    Mat darkMask, brightMask;
    inRange(grayFrame, 0, 15, darkMask);
    inRange(grayFrame, 240, 255, brightMask);

    metrics.darkPixelRatio = ((double)countNonZero(darkMask) / totalPixels) * 100.0;
    metrics.brightPixelRatio = ((double)countNonZero(brightMask) / totalPixels) * 100.0;

    // c. Mật độ Cạnh (Edge Density)
    Mat laplacianMat, edgeMask;
    Laplacian(grayFrame, laplacianMat, CV_16S, 3);
    convertScaleAbs(laplacianMat, laplacianMat);
    threshold(laplacianMat, edgeMask, 20, 255, THRESH_BINARY);
    metrics.edgeDensity = ((double)countNonZero(edgeMask) / totalPixels) * 100.0;

    return metrics;
}

int main() {
    string videoPath = "C:\\Users\\Admin\\Documents\\opencvtest\\camera video 2.mp4";
    VideoCapture capture(videoPath);

    if (!capture.isOpened()) {
        cerr << "Loi: Khong the mo camera/video!" << endl;
        return -1;
    }

    double fps = capture.get(CAP_PROP_FPS);
    if (fps <= 0) fps = 30.0;

    Mat frame, grayFrame;
    int frameIndex = 0;

    // --- BIẾN QUẢN LÝ BASELINE (NỀN GỐC) ---
    Mat baseGrayFrame;
    CameraMetrics baseMetrics;
    bool isBaselineSet = false;
    const int WARMUP_FRAMES = 15; // Lấy 15 frame đầu để ổn định trước khi chốt Baseline

    // --- BỘ ĐẾM THỜI GIAN THEO DÕI ---
    double lightChangeDurationSec = 0.0; // Thời gian biến đổi độ sáng/tối
    double objectPresentDurationSec = 0.0; // Thời gian xuất hiện vật thể mới

    const double ALERT_THRESHOLD_SEC = 3.0; // Ngưỡng cảnh báo: 3 giây

    cout << "=== HE THONG GIAM SAT CAMERA & PHAT HIEN VAT THE (3 SECONDS) ===" << endl;

    while (true) {
        capture >> frame;
        if (frame.empty()) break;

        frameIndex++;
        double currentTimeSec = frameIndex / fps;
        cvtColor(frame, grayFrame, COLOR_BGR2GRAY);

        // 1. THIẾT LẬP MỐC GỐC (BASELINE)
        if (!isBaselineSet) {
            if (frameIndex == WARMUP_FRAMES) {
                baseGrayFrame = grayFrame.clone();
                baseMetrics = computeMetrics(baseGrayFrame);
                isBaselineSet = true;
                cout << ">> [INFO] Da thiet lap Baseline thanh cong (Frame " << frameIndex << ")" << endl;
                cout << "   - Do sang goc: " << baseMetrics.meanBrightness 
                     << " | Tuong phan goc: " << baseMetrics.stdDevContrast << endl;
            }
            imshow("Camera Health Monitor", frame);
            if (waitKey(30) == 'q') break;
            continue;
        }

        // 2. TÍNH CHỈ SỐ FRAME HIỆN TẠI
        CameraMetrics currentMetrics = computeMetrics(grayFrame);

        // -------------------------------------------------------------
        // YÊU CẦU 1: PHÁT HIỆN THAY ĐỔI ĐỘ SÁNG / TỐI ĐỘT NGỘT VS BASELINE
        // -------------------------------------------------------------
        // Độ lệch độ sáng trung bình > 35.0 HOẶC tỷ lệ vùng tối/sáng biến động mạnh
        double brightnessDiff = abs(currentMetrics.meanBrightness - baseMetrics.meanBrightness);
        double darkDiff = abs(currentMetrics.darkPixelRatio - baseMetrics.darkPixelRatio);
        double brightDiff = abs(currentMetrics.brightPixelRatio - baseMetrics.brightPixelRatio);

        bool isLightChanged = (brightnessDiff > 35.0) || (darkDiff > 25.0) || (brightDiff > 25.0);

        if (isLightChanged) {
            lightChangeDurationSec += (1.0 / fps);
        } else {
            lightChangeDurationSec = max(0.0, lightChangeDurationSec - (1.0 / fps));
        }

        // -------------------------------------------------------------
        // YÊU CẦU 2: PHÁT HIỆN VẬT THỂ MỚI XUẤT HIỆN VÀ TỒN TẠI (FG MASK)
        // -------------------------------------------------------------
        Mat bgDiff, fgMask;
        absdiff(baseGrayFrame, grayFrame, bgDiff);
        
        // Nhận diện pixel khác biệt rõ so với background
        threshold(bgDiff, fgMask, 35, 255, THRESH_BINARY);
        
        // Lọc nhiễu nhẹ bằng Opencv Morphology
        Mat kernel = getStructuringElement(MORPH_RECT, Size(5, 5));
        morphologyEx(fgMask, fgMask, MORPH_OPEN, kernel);

        double objectAreaRatio = ((double)countNonZero(fgMask) / (fgMask.rows * fgMask.cols)) * 100.0;

        // Nếu diện tích biến đổi > 5% diện tích khung hình -> Có vật thể xuất hiện
        bool isObjectDetected = (objectAreaRatio > 5.0);

        if (isObjectDetected) {
            objectPresentDurationSec += (1.0 / fps);
        } else {
            objectPresentDurationSec = max(0.0, objectPresentDurationSec - (1.0 / fps));
        }

        // -------------------------------------------------------------
        // 3. HIỂN THỊ VÀ CẢNH BÁO LÊN MÀN HÌNH
        // -------------------------------------------------------------
        // Overlay thông số
        rectangle(frame, Point(10, 10), Point(480, 85), Scalar(0, 0, 0), FILLED);
        
        string infoLight = "Light Diff: " + to_string(brightnessDiff).substr(0, 4) + 
                           " (Timer: " + to_string(lightChangeDurationSec).substr(0, 3) + "s)";
        string infoObj = "Object Area: " + to_string(objectAreaRatio).substr(0, 4) + 
                         "% (Timer: " + to_string(objectPresentDurationSec).substr(0, 3) + "s)";

        putText(frame, infoLight, Point(15, 35), FONT_HERSHEY_SIMPLEX, 0.5, Scalar(0, 255, 255), 1);
        putText(frame, infoObj, Point(15, 65), FONT_HERSHEY_SIMPLEX, 0.5, Scalar(255, 255, 0), 1);

        int alertY = 95;

        // Banner Cảnh báo 1: Đổi độ sáng đột ngột kéo dài >= 3s
        if (lightChangeDurationSec >= ALERT_THRESHOLD_SEC) {
            rectangle(frame, Point(10, alertY), Point(550, alertY + 35), Scalar(0, 0, 200), FILLED);
            string alertMsg = "CANH BAO: BIEN DOI DO SANG DOT NGOT (>3s)";
            putText(frame, alertMsg, Point(15, alertY + 24), FONT_HERSHEY_SIMPLEX, 0.55, Scalar(255, 255, 255), 2);
            alertY += 45;
        }

        // Banner Cảnh báo 2: Vật thể xuất hiện kéo dài >= 3s
        if (objectPresentDurationSec >= ALERT_THRESHOLD_SEC) {
            rectangle(frame, Point(10, alertY), Point(550, alertY + 35), Scalar(0, 100, 255), FILLED);
            string alertMsg = "CANH BAO: VAT THE MOI XUAT HIEN (>3s)";
            putText(frame, alertMsg, Point(15, alertY + 24), FONT_HERSHEY_SIMPLEX, 0.55, Scalar(255, 255, 255), 2);
        }

        imshow("Camera Health Monitor", frame);

        int key = waitKey(30);
        if (key == 'q' || key == 27) break;
    }

    destroyAllWindows();
    return 0;
}